// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

/**
 * @param {import('node:test').TestContext} t
 * @param {Readonly<Record<string,string>> | ((source: string) => Readonly<Record<string,string>>)} input
 */
function prepare(t, input) {
  const directory = mkdtempSync(join(tmpdir(), "playwright-sources-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "original");
  const scope = join(directory, "scope");
  mkdirSync(join(source, "sources.list.d"), { recursive: true });
  mkdirSync(scope);
  const files = typeof input === "function" ? input(source) : input;
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(source, name), text, { mode: 0o644 });
  const result = spawnSync(
    process.execPath,
    ["scripts/prepare-playwright-apt-sources.mjs", source, scope],
    { encoding: "utf8", timeout: 5_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  for (const [name, text] of Object.entries(files))
    assert.equal(readFileSync(join(source, name), "utf8"), text);
  return {
    source,
    scope,
    file: (/** @type {string} */ name) =>
      readFileSync(join(scope, name), "utf8"),
  };
}

test("only the exact active Microsoft Ubuntu24 feed is removed from a list", (t) => {
  const kept =
    "# deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n" +
    "deb [arch=amd64 signed-by=/keys/ubuntu.gpg] https://archive.ubuntu.com/ubuntu noble main restricted\n" +
    "deb https://packages.microsoft.com/repos/azure-cli noble main\n" +
    "deb https://packages.microsoft.com/ubuntu/22.04/prod jammy main\n" +
    "deb https://packages.microsoft.com/ubuntu/24.04/prod-extra noble main\n" +
    "deb https://packages.microsoft.com.evil.example/ubuntu/24.04/prod noble main\n";
  const r = prepare(t, {
    "sources.list":
      "deb [signed-by=/keys/ms.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n" +
      kept,
  });
  assert.equal(r.file("sources.list"), kept);
});

test("mixed multiline deb822 keeps other URIs, suites, architectures and signed-by", (t) => {
  const suffix =
    "Suites: noble noble-updates\nComponents: main restricted\nArchitectures: amd64 arm64\nSigned-By: /keys/real-ubuntu.gpg\n";
  const r = prepare(t, {
    "sources.list.d/mixed.sources":
      "Types: deb deb-src\nURIs: https://packages.microsoft.com/ubuntu/24.04/prod/\n https://archive.ubuntu.com/ubuntu https://packages.microsoft.com/repos/azure-cli\n" +
      suffix,
  });
  assert.equal(
    r.file("sources.list.d/mixed.sources"),
    "Types: deb deb-src\nURIs: https://archive.ubuntu.com/ubuntu https://packages.microsoft.com/repos/azure-cli\n" +
      suffix,
  );
});

test("a Microsoft-only deb822 stanza is removed without losing a separate Ubuntu stanza", (t) => {
  const ubuntu =
    "Types: deb\nURIs: https://archive.ubuntu.com/ubuntu\nSuites: noble\nComponents: main\nSigned-By: /keys/ubuntu.gpg\n";
  const r = prepare(t, {
    "sources.list.d/mixed.sources":
      "Types: deb\nURIs: https://packages.microsoft.com/ubuntu/24.04/prod\nSuites: noble\nComponents: main\n\n" +
      ubuntu,
  });
  assert.equal(r.file("sources.list.d/mixed.sources"), "\n\n" + ubuntu);
});

test("disabled and unrecognized deb822 forms remain intact", (t) => {
  const disabled =
    "Enabled: no\nTypes: deb\nURIs: https://packages.microsoft.com/ubuntu/24.04/prod\nSuites: noble\nComponents: main\n";
  const unknown =
    "Types: deb\nURIs: https://packages.microsoft.com/ubuntu/24.04/prod\nURIs: https://archive.ubuntu.com/ubuntu\nSuites: noble\n";
  const r = prepare(t, {
    "sources.list.d/disabled.sources": disabled,
    "sources.list.d/unknown.sources": unknown,
  });
  assert.equal(r.file("sources.list.d/disabled.sources"), disabled);
  assert.equal(r.file("sources.list.d/unknown.sources"), unknown);
});

test("the runner mirror file is scoped with its priorities and accessible file modes", (t) => {
  const mirrors =
    "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n";
  const r = prepare(t, (source) => ({
    "sources.list.d/ubuntu.sources":
      "Types: deb\nURIs: mirror+file:" +
      join(source, "apt-mirrors.txt") +
      "\nSuites: noble\nComponents: main\n",
    "apt-mirrors.txt": mirrors,
  }));
  assert.equal(r.file("apt-mirrors.txt"), mirrors);
  assert.equal(
    r.file("sources.list.d/ubuntu.sources"),
    "Types: deb\nURIs: mirror+file:" +
      join(r.scope, "apt-mirrors.txt") +
      "\nSuites: noble\nComponents: main\n",
  );
  assert.equal(statSync(r.scope).mode & 0o777, 0o755);
  assert.equal(statSync(join(r.scope, "sources.list.d")).mode & 0o777, 0o755);
  assert.equal(statSync(join(r.scope, "apt-mirrors.txt")).mode & 0o777, 0o644);
});

test("the scoped process config preserves other feeds' list cache without changing dpkg or trust", (t) => {
  const r = prepare(t, {});
  assert.equal(
    r.file("apt.conf"),
    'Dir::Etc::sourcelist "' +
      join(r.scope, "sources.list") +
      '";\n' +
      'Dir::Etc::sourceparts "' +
      join(r.scope, "sources.list.d") +
      '";\n' +
      'APT::Get::List-Cleanup "false";\n',
  );
  assert.doesNotMatch(
    r.file("apt.conf"),
    /Dir::State|Dir::Etc::trusted|AllowUnauthenticated|Check-Valid-Until|Error-Mode/u,
  );
});

test("a nonempty scope is refused without deleting its existing files", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "playwright-nonempty-scope-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = join(directory, "original");
  const scope = join(directory, "scope");
  mkdirSync(source);
  mkdirSync(scope);
  writeFileSync(join(scope, "owned.txt"), "preserve");
  const r = spawnSync(
    process.execPath,
    [resolve("scripts/prepare-playwright-apt-sources.mjs"), source, scope],
    { encoding: "utf8", timeout: 5_000 },
  );
  assert.ifError(r.error);
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(join(scope, "owned.txt"), "utf8"), "preserve");
  assert.deepEqual(readdirSync(scope), ["owned.txt"]);
});

test(
  "native Linux APT keeps root defaults and other indexes with the selected offline source",
  {
    skip:
      process.platform !== "linux" ||
      !existsSync("/usr/share/keyrings/ubuntu-archive-keyring.gpg"),
  },
  (t) => {
    const r = prepare(t, (source) => ({
      "sources.list":
        "deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] file:" +
        join(source, "repository") +
        " noble restricted\n",
    }));
    const repo = join(r.source, "repository");
    const suite = join(repo, "dists/noble");
    const packages = join(suite, "restricted/binary-amd64");
    mkdirSync(packages, { recursive: true });
    copyFileSync(
      "scripts/fixtures/playwright-apt-noble/InRelease",
      join(suite, "InRelease"),
    );
    copyFileSync(
      "scripts/fixtures/playwright-apt-noble/Packages.xz",
      join(packages, "Packages.xz"),
    );
    // Let the real APT sandbox read this test's public signed repository.
    chmodSync(resolve(r.source, ".."), 0o755);
    const lists = join(r.scope, "lists");
    mkdirSync(join(lists, "partial"), { recursive: true });
    const otherIndex = join(lists, "other.example_dists_noble_InRelease");
    copyFileSync(join(suite, "InRelease"), otherIndex);
    const originalIndex = readFileSync(otherIndex);
    const statusBefore = createHash("sha256")
      .update(readFileSync("/var/lib/dpkg/status"))
      .digest("hex");
    const env = { ...process.env, APT_CONFIG: join(r.scope, "apt.conf") };
    const common = [
      `-oDir::State::lists=${lists}`,
      "-oDir::Cache::pkgcache=",
      "-oDir::Cache::srcpkgcache=",
      "-oAPT::Update::Error-Mode=any",
    ];
    /** @param {string[]} args */
    const apt = (args) => {
      const result = spawnSync("apt-get", [...common, ...args], {
        env,
        encoding: "utf8",
        timeout: 5_000,
      });
      assert.ifError(result.error);
      // Never include config/debug stderr, which may contain unrelated settings.
      assert.equal(
        result.status,
        0,
        "native apt-get failed; raw output withheld",
      );
      return result;
    };
    // Refuse any non-fixture source before real Acquire can perform work.
    const printed = apt(["--print-uris", "update"]);
    const uris = printed.stdout
      .split("\n")
      .filter((line) => line.startsWith("'"));
    assert.ok(uris.length > 0, "the offline source was not selected");
    assert.ok(
      uris.every((line) => line.startsWith(`'file:${repo}/`)),
      "APT selected a source outside the offline fixture; update not run",
    );
    const updated = apt(["-oDebug::pkgAcquire::Worker=1", "update"]);
    // Worker protocol debug is percent-encoded. Decode in memory and expose only
    // the two fixed parent values erased by the old Binary::apt-get subtree.
    const protocol = updated.stderr.replace(
      /%([0-9a-f]{2})/giu,
      (_match, /** @type {string} */ hex) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
    );
    const dirs = [...protocol.matchAll(/^Config-Item: Dir=([^\r\n]*)$/gmu)].map(
      (match) => match[1],
    );
    const etc = [
      ...protocol.matchAll(/^Config-Item: Dir::Etc=([^\r\n]*)$/gmu),
    ].map((match) => match[1]);
    assert.ok(dirs.length > 0, "native Acquire lost the Dir root default");
    assert.deepEqual([...new Set(dirs)], ["/"], "native Acquire Dir changed");
    assert.ok(etc.length > 0, "native Acquire lost the Dir::Etc default");
    assert.deepEqual(
      [...new Set(etc)],
      ["etc/apt"],
      "native Acquire Dir::Etc changed",
    );
    assert.ok(
      readFileSync(otherIndex).equals(originalIndex),
      "other consumer index bytes changed",
    );
    assert.equal(
      createHash("sha256")
        .update(readFileSync("/var/lib/dpkg/status"))
        .digest("hex"),
      statusBefore,
    );
    const targets = apt(["indextargets", "--format", "$(URI)"]);
    assert.ok(
      targets.stdout.includes(`file:${repo}/`),
      "offline index missing",
    );
    t.diagnostic(
      "Real Acquire retained Dir=/, Dir::Etc=etc/apt and the other index; offline signed source selected.",
    );
  },
);
