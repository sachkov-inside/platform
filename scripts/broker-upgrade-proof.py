#!/usr/bin/env python3
"""Upgrade self-created RabbitMQ data; never accepts an existing volume or publishes ports."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import re
import signal
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("foundation_commands", ROOT / "scripts/foundation-recovery-proof.py")
commands = importlib.util.module_from_spec(spec)
spec.loader.exec_module(commands)
LABEL = "inside.broker-upgrade-proof"
OLD = "ghcr.io/sachkov-inside/rabbitmq:4.2.4-alpine@sha256:83522278ca69414e4895b3ea3c0f943c63ad316c063f9cda9c32fd42fe800f47"
NEW = "ghcr.io/sachkov-inside/rabbitmq:4.4.0-alpine@sha256:7b77c3d3a996c7fcca1ca8bf53ce1557ff43c13b8ca2c132df6031781b209ef2"

CLIENT = r'''
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const amqp = createRequire('/app/package.json')('amqplib');
const connection = await amqp.connect('amqp://proof:inside-proof@rabbitmq');
try {
  const channel = await connection.createConfirmChannel();
  const queue = 'upgrade-proof';
  await channel.assertQueue(queue, {durable:true, arguments:{'x-queue-type':'quorum'}});
  const mode = process.argv[1];
  if (mode === 'seed') {
    for (const id of ['acked', 'one', 'two', 'three']) {
      channel.sendToQueue(queue, Buffer.from(id), {persistent:true, messageId:id});
    }
    await channel.waitForConfirms();
    const acked = await channel.get(queue);
    assert.equal(acked?.properties.messageId, 'acked');
    channel.ack(acked);
    const unacked = await channel.get(queue);
    assert.equal(unacked?.properties.messageId, 'one');
    // Closing the connection requeues the unacknowledged persistent message.
  } else {
    const expected = mode === 'after-restart' ? ['after-upgrade'] : ['one', 'three', 'two'];
    const received = [];
    for (const id of expected) {
      const message = await channel.get(queue);
      assert.ok(message, 'missing persistent message');
      received.push(message.properties.messageId);
      assert.equal(message.content.toString(), message.properties.messageId);
      channel.ack(message);
    }
    assert.deepEqual(received.sort(), [...expected].sort());
    assert.equal(await channel.get(queue), false, 'unexpected duplicate message');
    if (mode === 'upgraded') {
      channel.sendToQueue(queue, Buffer.from('after-upgrade'), {persistent:true, messageId:'after-upgrade'});
      await channel.waitForConfirms();
    }
  }
} finally {
  await connection.close();
}
'''
HASH = r'''
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=crypto.createHash('sha256');
function walk(dir) {
 for(const name of fs.readdirSync(dir).sort()) {
  const p=path.join(dir,name),s=fs.lstatSync(p);
  hash.update(JSON.stringify([p,s.mode,s.uid,s.gid]));
  if(s.isDirectory()) walk(p);
  else if(s.isSymbolicLink()) hash.update(fs.readlinkSync(p));
  else hash.update(fs.readFileSync(p));
 }
}
walk('/source');console.log(hash.digest('hex'));
'''


class Proof:
    def __init__(self, directory, recover=False):
        self.directory = directory
        self.journal = directory / "resources.json"
        self.endpoint = commands.local_endpoint()
        self.docker = ["docker", "--host", self.endpoint]
        self.daemon = json.loads(self.run("info", "--format", "{{json .ID}}").stdout)
        if recover:
            if self.journal.is_symlink():
                raise ValueError("symlink resource journal")
            data = json.loads(self.journal.read_text())
            if data["endpoint"] != self.endpoint or data["daemon"] != self.daemon:
                raise ValueError("resource daemon identity changed")
            self.owner, self.resources = data["owner"], data["resources"]
        else:
            if self.journal.exists():
                raise ValueError("clean the previous proof before retrying")
            self.owner, self.resources = uuid.uuid4().hex, []
        if not re.fullmatch(r"[a-f0-9]{32}", self.owner):
            raise ValueError("invalid resource owner")
        self.prefix = "inside-broker-proof-" + self.owner
        for kind, name in self.resources:
            if kind not in ("container", "volume", "network") or not re.fullmatch(self.prefix + r"-[a-z0-9-]+", name):
                raise ValueError("foreign resource in journal")
        self.save()

    def run(self, *args, **kwargs):
        return commands.invoke([*self.docker, *args], **kwargs)

    def save(self):
        temporary = self.directory / "resources.next.json"
        temporary.write_text(json.dumps(dict(owner=self.owner, resources=self.resources,
                                             endpoint=self.endpoint, daemon=self.daemon)))
        temporary.replace(self.journal)

    def name(self, kind, suffix):
        name = self.prefix + "-" + suffix
        self.resources.append((kind, name))
        self.save()
        return name

    def create(self, kind, suffix):
        name = self.name(kind, suffix)
        self.run(kind, "create", "--label", LABEL + "=" + self.owner, name)
        return name

    def cleanup(self):
        # Query failures remain failures. Never interpret an unavailable daemon as empty.
        if json.loads(self.run("info", "--format", "{{json .ID}}").stdout) != self.daemon:
            raise ValueError("resource daemon identity changed during proof")
        for kind in ("container", "network", "volume"):
            args = ["ps", "--all"] if kind == "container" else [kind, "ls"]
            rows = self.run(*args, "--filter", "label=" + LABEL + "=" + self.owner,
                            "--format", "{{.ID}} {{.Names}}" if kind == "container" else "{{.Name}}").stdout.splitlines()
            for row in rows:
                identity, name = row.split(" ", 1) if kind == "container" else (row, row)
                if (kind, name) not in [tuple(item) for item in self.resources]:
                    raise ValueError("unexpected labelled resource")
                self.run("rm", "--force", identity) if kind == "container" else self.run(kind, "rm", name)

    def broker(self, image, volume, suffix):
        name = self.name("container", suffix)
        self.run("run", "--detach", "--name", name, "--hostname", "rabbitmq",
                 "--label", LABEL + "=" + self.owner, "--network", self.network,
                 "--network-alias", "rabbitmq", "--memory", "768m", "--cpus", "2",
                 "--env", "RABBITMQ_DEFAULT_USER=proof", "--env", "RABBITMQ_DEFAULT_PASS=inside-proof",
                 "--env", "RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS=+S 2:2",
                 "--mount", "type=volume,src=" + volume + ",dst=/var/lib/rabbitmq", image)
        self.wait_ready(name)
        return name

    def wait_ready(self, name):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if self.run("exec", "--user", "rabbitmq", name, "rabbitmq-diagnostics", "-q", "check_running", check=False, timeout=15).returncode == 0:
                alarms = self.run("exec", "--user", "rabbitmq", name, "rabbitmq-diagnostics", "-q", "check_local_alarms", check=False)
                if alarms.returncode == 0:
                    return
            time.sleep(1)
        raise TimeoutError("broker did not become ready")

    def client(self, mode):
        self.run("run", "--rm", "--name", self.name("container", "client-" + mode),
                 "--label", LABEL + "=" + self.owner, "--network", self.network,
                 "--memory", "256m", "--cpus", "1", "--entrypoint", "node",
                 self.client_image, "--input-type=module", "-e", CLIENT, mode)

    def helper(self, suffix, *args):
        return self.run("run", "--rm", "--name", self.name("container", suffix),
                        "--label", LABEL + "=" + self.owner, "--network", "none", "--user", "0",
                        "--memory", "256m", "--cpus", "1", *args)

    def hash(self, volume, suffix):
        value = self.helper(suffix, "--mount", "type=volume,src=" + volume + ",dst=/source,readonly",
                            "--entrypoint", "node", self.client_image, "-e", HASH).stdout.strip()
        if not re.fullmatch(r"[a-f0-9]{64}", value):
            raise ValueError("invalid volume hash")
        return value

    def flags(self, container):
        self.run("exec", "--user", "rabbitmq", container, "rabbitmqctl", "enable_feature_flag", "all")
        flags = json.loads(self.run("exec", "--user", "rabbitmq", container, "rabbitmqctl", "list_feature_flags", "name", "state", "stability", "--formatter", "json").stdout)
        stable = [flag for flag in flags if flag["stability"] == "stable"]
        if not stable or any(flag["state"] != "enabled" for flag in stable):
            raise ValueError("stable feature flags are not enabled")
        return sorted(flag["name"] for flag in stable)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-directory", type=pathlib.Path, required=True)
    parser.add_argument("--client-image")
    parser.add_argument("--receipt", type=pathlib.Path)
    parser.add_argument("--target-image", default=NEW, choices=[NEW, NEW.replace("ghcr.io/sachkov-inside/", "docker.io/library/")])
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()
    args.state_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    proof = Proof(args.state_directory, recover=args.cleanup_only)
    if args.cleanup_only:
        proof.cleanup()
        return
    if not args.client_image or not args.receipt:
        parser.error("client image and receipt are required")
    try:
        proof.client_image = args.client_image
        # All data volumes are generated here. No argument can name production or stand data.
        for image in (OLD, args.target_image):
            proof.run("pull", image)
        proof.network = proof.create("network", "network")
        original = proof.create("volume", "source")
        candidate = proof.create("volume", "candidate")
        old = proof.broker(OLD, original, "old")
        old_version = proof.run("exec", "--user", "rabbitmq", old, "rabbitmqctl", "version").stdout.strip()
        if old_version != "4.2.4":
            raise ValueError("unexpected source broker version")
        before_flags = proof.flags(old)
        proof.client("seed")
        proof.run("stop", "--time", "30", old)
        proof.run("rm", old)
        before = proof.hash(original, "hash-before")
        proof.helper("clone", "--mount", "type=volume,src=" + original + ",dst=/source,readonly",
                     "--mount", "type=volume,src=" + candidate + ",dst=/target",
                     "--entrypoint", "sh", proof.client_image, "-ec", "cp -a /source/. /target/")
        upgraded = proof.broker(args.target_image, candidate, "upgraded")
        new_version = proof.run("exec", "--user", "rabbitmq", upgraded, "rabbitmqctl", "version").stdout.strip()
        if new_version != "4.4.0":
            raise ValueError("unexpected target broker version")
        proof.client("upgraded")
        after_flags = proof.flags(upgraded)
        proof.run("stop", "--time", "30", upgraded)
        proof.run("start", upgraded)
        proof.wait_ready(upgraded)
        proof.client("after-restart")
        if proof.hash(original, "hash-after") != before:
            raise ValueError("upgrade modified the original cold volume")
        # Prove the cold recovery path on a second copy, preserving the original throughout.
        proof.run("stop", "--time", "30", upgraded)
        recovery = proof.create("volume", "cold-recovery")
        proof.helper("clone-recovery", "--mount", "type=volume,src=" + original + ",dst=/source,readonly",
                     "--mount", "type=volume,src=" + recovery + ",dst=/target",
                     "--entrypoint", "sh", proof.client_image, "-ec", "cp -a /source/. /target/")
        proof.broker(OLD, recovery, "recovered-old")
        proof.client("cold-recovery")
        if proof.hash(original, "hash-after-recovery") != before:
            raise ValueError("recovery modified the original cold volume")
        receipt = dict(schemaVersion=1,
                       sourceSha=commands.invoke(["git", "-C", str(ROOT), "rev-parse", "HEAD"]).stdout.strip(),
                       proofSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
                       coldOldVersionRecoveryPassed=True, sourceVersion="4.2.4", targetVersion="4.4.0",
                       targetImage=args.target_image, clientImage=args.client_image,
                       architecture=proof.run("info", "--format", "{{.Architecture}}").stdout.strip(),
                       sourceImageId=proof.run("image", "inspect", "--format", "{{.Id}}", OLD).stdout.strip(),
                       targetImageId=proof.run("image", "inspect", "--format", "{{.Id}}", args.target_image).stdout.strip(),
                       beforeStableFlags=before_flags, afterStableFlags=after_flags,
                       originalVolumeSha256=before, originalUnchanged=True,
                       confirmedMessagesPreserved=3, unackedMessageRequeued=True,
                       acknowledgedMessageAbsent=True, postUpgradeRestartPreserved=True,
                       rollback="cold pre-upgrade copy only; never downgrade the upgraded volume")
    finally:
        proof.cleanup()
    receipt["cleanupPassed"] = True
    args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
    print("RabbitMQ persistent-message upgrade and cleanup passed.")


if __name__ == "__main__":
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, commands.terminate)
    main()
