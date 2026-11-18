// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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

test("apt-get-only overrides preserve other feeds' list cache without changing dpkg or trust", (t) => {
  const r = prepare(t, {});
  assert.equal(
    r.file("apt.conf"),
    'Binary::apt-get::Dir::Etc::sourcelist "' +
      join(r.scope, "sources.list") +
      '";\n' +
      'Binary::apt-get::Dir::Etc::sourceparts "' +
      join(r.scope, "sources.list.d") +
      '";\n' +
      'Binary::apt-get::APT::Get::List-Cleanup "false";\n',
  );
  assert.doesNotMatch(
    r.file("apt.conf"),
    /Dir::State|Dir::Etc::trusted|AllowUnauthenticated|Check-Valid-Until|Error-Mode/u,
  );
});

test("a nonempty scope is refused without deleting its existing files", (t) => {
  const scope = mkdtempSync(join(tmpdir(), "playwright-nonempty-scope-"));
  t.after(() => rmSync(scope, { recursive: true, force: true }));
  writeFileSync(join(scope, "owned.txt"), "preserve");
  const r = spawnSync(
    process.execPath,
    [resolve("scripts/prepare-playwright-apt-sources.mjs"), scope, scope],
    { encoding: "utf8", timeout: 5_000 },
  );
  assert.ifError(r.error);
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(join(scope, "owned.txt"), "utf8"), "preserve");
  assert.deepEqual(readdirSync(scope), ["owned.txt"]);
});
