import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const provision = readFileSync(
  "infra/production/host/provision-host.sh",
  "utf8",
);

describe("restricted production deployment key", () => {
  it("installs one idempotent forced-command key", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "inside-deploy-key-"));
    const root = resolve(directory, "host");
    const privateKey = resolve(directory, "id_ed25519");
    mkdirSync(root);
    try {
      const generated = spawnSync(
        "ssh-keygen",
        ["-q", "-t", "ed25519", "-N", "", "-f", privateKey],
        { encoding: "utf8" },
      );
      assert.equal(generated.status, 0, generated.stderr);

      const first = runInstaller(root, `${privateKey}.pub`);
      assert.equal(first.status, 0, first.stderr);
      const authorizedKeys = resolve(
        root,
        "home/inside-deploy/.ssh/authorized_keys",
      );
      const key = readFileSync(`${privateKey}.pub`, "utf8")
        .trim()
        .split(/\s+/u)
        .slice(0, 2)
        .join(" ");
      const expected = `restrict,command="sudo -n /usr/local/libexec/inside/inside-deploy" ${key}\n`;
      assert.equal(readFileSync(authorizedKeys, "utf8"), expected);

      const second = runInstaller(root, `${privateKey}.pub`);
      assert.equal(second.status, 0, second.stderr);
      assert.equal(readFileSync(authorizedKeys, "utf8"), expected);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("rejects an invalid public key without replacing the installed key", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "inside-deploy-key-"));
    const root = resolve(directory, "host");
    const invalid = resolve(directory, "invalid.pub");
    mkdirSync(root);
    writeFileSync(invalid, "ssh-ed25519 not-a-key\n");
    try {
      const result = runInstaller(root, invalid);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /valid Ed25519 public key/u);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("provisions only the forced command through sudo", () => {
    assert.match(provision, /apt-get install --yes[\s\S]*?jq/u);
    assert.match(
      provision,
      /install -m 755[\s\S]*?inside-deploy[\s\S]*?\/usr\/local\/libexec\/inside\/inside-deploy/u,
    );
    assert.match(provision, /Defaults:inside-deploy env_keep \+= "SSH_ORIGINAL_COMMAND"/u);
    assert.match(
      provision,
      /inside-deploy ALL=\(root\) NOPASSWD: \/usr\/local\/libexec\/inside\/inside-deploy/u,
    );
    assert.match(provision, /visudo --check/u);
    assert.doesNotMatch(provision, /inside-deploy ALL=\(ALL/u);
  });
});

function runInstaller(root, publicKey) {
  return spawnSync(
    "bash",
    ["infra/production/host/configure-deploy-key.sh", publicKey],
    {
      encoding: "utf8",
      env: { ...process.env, INSIDE_DEPLOY_TEST_ROOT: root },
    },
  );
}
