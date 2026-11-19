// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

const action = readFileSync(
  ".github/actions/setup-platform/action.yml",
  "utf8",
);
const installStep = action
  .split("- name: Install browser engines and system dependencies\n")[1]
  ?.split("\n    - name:")[0];
assert.ok(installStep);
const command = installStep.split("      run: |\n")[1]?.replace(/^ {8}/gmu, "");
assert.ok(command);
const shellCommand = command;

/**
 * @param {import('node:test').TestContext} t
 * @param {string} failures
 * @param {Readonly<Record<string, string>>} [sourceFiles]
 */
function install(
  t,
  failures,
  sourceFiles = {
    "sources.list": "deb http://azure.archive.ubuntu.com/ubuntu noble main\n",
    "sources.list.d/ubuntu.sources":
      "URIs: https://azure.archive.ubuntu.com/ubuntu\n",
    "apt-mirrors.txt":
      "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n",
    "sources.list.d/vendor.list":
      "deb http://vendor.example/ubuntu noble main\n",
  },
) {
  const directory = mkdtempSync(join(tmpdir(), "platform-apt-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, "commands");
  const sources = join(directory, "apt");
  const lists = join(directory, "lists");
  mkdirSync(lists);
  writeFileSync(
    join(lists, "microsoft-prod_InRelease"),
    "retained other-consumer index",
  );
  mkdirSync(join(sources, "sources.list.d"), { recursive: true });
  for (const [name, content] of Object.entries(sourceFiles)) {
    writeFileSync(join(sources, name), content);
  }
  const aptModel = join(directory, "apt-model.mjs");
  writeFileSync(
    aptModel,
    `
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const [config, source, mode, lists, log] = process.argv.slice(2);
const text = config ? readFileSync(config, 'utf8') : '';
const main = text.match(/^Dir::Etc::sourcelist "(.*)";$/mi)?.[1] ?? join(source, 'sources.list');
const parts = text.match(/^Dir::Etc::sourceparts "(.*)";$/mi)?.[1] ?? join(source, 'sources.list.d');
const preserveLists = /^APT::Get::List-Cleanup "false";$/mi.test(text);
const files = [main, ...readdirSync(parts).filter(n => n.endsWith('.list') || n.endsWith('.sources')).map(n => join(parts, n))];
const feeds = files.filter(existsSync).map(f => readFileSync(f, 'utf8')).join(String.fromCharCode(10));
appendFileSync(log, 'apt-model ' + JSON.stringify({ main, parts, preserveLists, config }) + String.fromCharCode(10));
if (mode.startsWith('microsoft429') && feeds.includes('https://packages.microsoft.com/ubuntu/24.04/prod')) {
  console.error('E: Failed to fetch https://packages.microsoft.com/ubuntu/24.04/prod/dists/noble/InRelease 429 Too Many Requests');
  process.exit(100);
}
if (mode === 'ubuntu100' || (mode === 'microsoft429+azure100' && feeds.includes('http://azure.archive.ubuntu.com/ubuntu'))) {
  console.error('E: Required Ubuntu source failed');
  process.exit(100);
}
if (!preserveLists) rmSync(join(lists, 'microsoft-prod_InRelease'));
`,
  );
  const stub = `#!/bin/bash
set -eu
echo "$(basename "$0") $*" >> "$INSTALL_TEST_LOG"
if [[ "$(basename "$0")" = node && "$1" = */prepare-playwright-apt-sources.mjs ]]; then
  exec "$INSTALL_TEST_NODE" "$1" "$INSTALL_TEST_SOURCES" "$3"
fi
if [[ "$(basename "$0")" = sudo ]]; then
  if [[ "$1" = tee ]]; then cat >> "$INSTALL_TEST_LOG"; fi
  if [[ "$1" = find ]]; then
    shift 2
    exec /usr/bin/find "$INSTALL_TEST_SOURCES" "$@"
  fi
  if [[ "$1" = timeout ]]; then
    count=0
    [[ ! -f "$INSTALL_TEST_LOG.count" ]] || count=$(cat "$INSTALL_TEST_LOG.count")
    count=$((count + 1))
    echo "$count" > "$INSTALL_TEST_LOG.count"
    active_sources="$INSTALL_TEST_SOURCES"
    configuration=""
    for argument in "$@"; do
      if [[ "$argument" = APT_CONFIG=* ]]; then
        configuration=$(echo "$argument" | cut -d= -f2-)
        active_sources=$(dirname "$configuration")
      fi
    done
    cp -R "$active_sources" "$INSTALL_TEST_SOURCES.attempt$count"
    "$INSTALL_TEST_NODE" "$INSTALL_TEST_APT_MODEL" "$configuration" "$INSTALL_TEST_SOURCES" "$INSTALL_TEST_MODE" "$INSTALL_TEST_LISTS" "$INSTALL_TEST_LOG" || exit "$?"
    if [[ "$INSTALL_TEST_MODE" != exit-codes ]]; then
      exit 0
    fi
    case "$count" in
      1) exit "$INSTALL_TEST_FIRST" ;;
      2) exit "$INSTALL_TEST_SECOND" ;;
      *) exit 99 ;;
    esac
  fi
fi
`;
  for (const name of ["sudo", "pnpm", "node"]) {
    writeFileSync(join(directory, name), stub, { mode: 0o755 });
  }
  writeFileSync(
    join(directory, "find"),
    `#!/bin/bash
echo "find $*" >> "$INSTALL_TEST_LOG"
exec /usr/bin/find "$@"
`,
    { mode: 0o755 },
  );
  // Translate GNU sed's in-place flag for the host's BSD sed, without changing its expression.
  writeFileSync(
    join(directory, "sed"),
    `#!/bin/bash
if [[ "$(uname)" = Darwin && "$1" = -i ]]; then
  shift
  exec /usr/bin/sed -i '' "$@"
fi
exec /usr/bin/sed "$@"
`,
    { mode: 0o755 },
  );
  const [first = "0", second = "0"] = failures.split(",");
  const result = spawnSync(
    "/bin/bash",
    ["-e", "-o", "pipefail", "-c", shellCommand],
    {
      cwd: resolve("."),
      env: {
        ...process.env,
        PATH: `${directory}:${process.env["PATH"]}`,
        HOME: directory,
        BROWSERS: "chromium webkit",
        INSTALL_TEST_LOG: log,
        INSTALL_TEST_SOURCES: sources,
        INSTALL_TEST_FIRST: first,
        INSTALL_TEST_SECOND: second,
        INSTALL_TEST_MODE: [
          "microsoft429",
          "microsoft429+azure100",
          "ubuntu100",
        ].includes(failures)
          ? failures
          : "exit-codes",
        INSTALL_TEST_NODE: process.execPath,
        INSTALL_TEST_APT_MODEL: aptModel,
        INSTALL_TEST_LISTS: lists,
      },
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  assert.ifError(result.error);
  const attempts = Number(readFileSync(`${log}.count`, "utf8"));
  const logged = readFileSync(log, "utf8");
  const aptCalls = logged
    .split("\n")
    .filter((line) => line.startsWith("apt-model "))
    .map((line) => {
      const row = /** @type {unknown} */ (
        JSON.parse(line.slice("apt-model ".length))
      );
      assert.ok(row !== null && typeof row === "object");
      assert.ok("main" in row && typeof row.main === "string");
      assert.ok("parts" in row && typeof row.parts === "string");
      assert.ok("config" in row && typeof row.config === "string");
      assert.ok(
        "preserveLists" in row && typeof row.preserveLists === "boolean",
      );
      return {
        main: row.main,
        parts: row.parts,
        config: row.config,
        preserveLists: row.preserveLists,
      };
    });
  return {
    ...result,
    log: logged,
    aptCalls,
    scopesRemoved: aptCalls.every((call) => !existsSync(dirname(call.config))),
    otherFeedIndexRetained: existsSync(join(lists, "microsoft-prod_InRelease")),
    originalSources: Object.fromEntries(
      Object.keys(sourceFiles).map((name) => [
        name,
        readFileSync(join(sources, name), "utf8"),
      ]),
    ),
    sources: Object.fromEntries(
      Object.keys(sourceFiles).map((name) => [
        name,
        readFileSync(
          join(`${sources}.attempt${String(attempts)}`, name),
          "utf8",
        ),
      ]),
    ),
  };
}

test("observed Microsoft 429 does not block browser dependencies or change the original feed", (t) => {
  const result = install(t, "microsoft429", {
    "sources.list": "deb http://azure.archive.ubuntu.com/ubuntu noble main\n",
    "sources.list.d/microsoft-prod.list":
      "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal((result.log.match(/sudo timeout/gmu) ?? []).length, 1);
  assert.match(result.log, /playwright install chromium webkit/u);
  assert.equal(result.otherFeedIndexRetained, true);
  assert.equal(result.scopesRemoved, true);
  const firstAptCall = result.aptCalls[0];
  assert.ok(firstAptCall);
  assert.equal(firstAptCall.preserveLists, true);
  assert.equal(
    result.originalSources["sources.list.d/microsoft-prod.list"],
    "deb [arch=amd64,arm64,armhf signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n",
  );
});

test("apt succeeds once under a root-owned deadline, then installs both engines", (t) => {
  const result = install(t, "0");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log, /Acquire::http::Timeout "15";/u);
  assert.match(result.log, /Acquire::https::Timeout "15";/u);
  assert.match(result.log, /Acquire::Retries "1";/u);
  assert.match(result.log, /APT::Update::Error-Mode "any";/u);
  assert.equal((result.log.match(/sudo timeout/gmu) ?? []).length, 1);
  assert.match(
    result.log,
    /sudo timeout --signal=KILL 180s .*install-deps chromium webkit/u,
  );
  assert.match(
    result.log,
    /pnpm --filter @inside\/web exec playwright install chromium webkit/u,
  );
  assert.doesNotMatch(result.log, /--with-deps|sudo find/u);
});

test("production access and nightly smoke use the bounded installer", () => {
  for (const workflow of ["production-access", "nightly-fullstack"]) {
    const source = readFileSync(`.github/workflows/${workflow}.yml`, "utf8");
    assert.match(
      source,
      /run: bash scripts\/install-playwright-ci\.sh chromium$/mu,
    );
    assert.doesNotMatch(source, /playwright install --with-deps/u);
  }
});

for (const failure of ["100", "124", "137"]) {
  test(`apt failure ${failure} switches the Azure mirror and retries once`, (t) => {
    const result = install(t, `${failure},0`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal((result.log.match(/sudo timeout/gmu) ?? []).length, 2);
    assert.match(
      result.log,
      /find \/tmp\/platform-playwright-apt\.[^ ]+ .*\.list.*\.sources.*archive\.ubuntu\.com/u,
    );
    assert.ok(result.log.includes("azure[.]archive[.]ubuntu[.]com/ubuntu"));
    assert.ok(result.log.includes("-name apt-mirrors.txt"));
    assert.equal(
      result.originalSources["sources.list"],
      "deb http://azure.archive.ubuntu.com/ubuntu noble main\n",
    );
    assert.equal(result.otherFeedIndexRetained, true);
    assert.equal(result.scopesRemoved, true);
    assert.match(result.log, /playwright install chromium webkit/u);
  });
}

test("fallback uses HTTPS before the second attempt in every Ubuntu source format", (t) => {
  const result = install(t, "137,0");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.sources["sources.list"],
    "deb https://archive.ubuntu.com/ubuntu noble main\n",
  );
  assert.equal(
    result.sources["sources.list.d/ubuntu.sources"],
    "URIs: https://archive.ubuntu.com/ubuntu\n",
  );
  assert.equal(
    result.sources["apt-mirrors.txt"],
    "https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n",
  );
  assert.equal(
    result.sources["sources.list.d/vendor.list"],
    "deb http://vendor.example/ubuntu noble main\n",
  );
});

test("a failed fallback preserves the exit code and never starts browser downloads", (t) => {
  const result = install(t, "124,100");
  assert.equal(result.status, 100, result.stderr);
  assert.equal((result.log.match(/sudo timeout/gmu) ?? []).length, 2);
  assert.doesNotMatch(result.log, /playwright install chromium/u);
  assert.equal(result.scopesRemoved, true);
});

test("Microsoft isolation keeps Ubuntu HTTPS fallback inside the two existing root deadlines", (t) => {
  const sources = {
    "sources.list": "deb http://azure.archive.ubuntu.com/ubuntu noble main\n",
    "sources.list.d/microsoft-prod.list":
      "deb [signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n",
  };
  const result = install(t, "microsoft429+azure100", sources);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (result.log.match(/sudo timeout --signal=KILL 180s/gmu) ?? []).length,
    2,
  );
  assert.equal(
    result.sources["sources.list"],
    "deb https://archive.ubuntu.com/ubuntu noble main\n",
  );
  assert.deepEqual(result.originalSources, sources);
  assert.equal(result.otherFeedIndexRetained, true);
  assert.equal(result.scopesRemoved, true);
});

test("a required Ubuntu source still fails after isolation and never downloads browsers", (t) => {
  const result = install(t, "ubuntu100");
  assert.equal(result.status, 100, result.stderr);
  assert.equal(
    (result.log.match(/sudo timeout --signal=KILL 180s/gmu) ?? []).length,
    2,
  );
  assert.match(result.stderr, /Required Ubuntu source failed/u);
  assert.doesNotMatch(result.log, /playwright install chromium/u);
  assert.equal(result.scopesRemoved, true);
  assert.equal(result.otherFeedIndexRetained, true);
});

test("observed EC2 mirror switches to HTTPS before attempt two without changing source options or other hosts", (t) => {
  const result = install(t, "137,0", {
    "sources.list":
      "deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu.gpg] http://us-east-2.ec2.archive.ubuntu.com/ubuntu/ noble-updates main restricted\n",
    "sources.list.d/ubuntu.sources":
      "Types: deb deb-src\nURIs: https://us-east-2.ec2.archive.ubuntu.com/ubuntu http://security.ubuntu.com/ubuntu\nSuites: noble noble-updates\nComponents: main restricted\nSigned-By: /usr/share/keyrings/ubuntu.gpg\n",
    "apt-mirrors.txt":
      "http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://us-east-2.ec2.archive.ubuntu.com/ubuntu?channel=noble\tpriority:2\nhttps://archive.ubuntu.com/ubuntu/\tpriority:3\nhttp://security.ubuntu.com/ubuntu/\tpriority:4\n",
    "sources.list.d/vendor.list":
      "deb http://vendor.example/ubuntu noble main\ndeb http://us-west-2.ec2.archive.ubuntu.com/ubuntu noble main\ndeb http://us-east-2.ec2.archive.ubuntu.com.evil.example/ubuntu noble main\ndeb http://us-east-2.ec2.archive.ubuntu.com/ubuntu-extra noble main\n",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (result.log.match(/sudo timeout --signal=KILL 180s/gmu) ?? []).length,
    2,
  );
  assert.equal(
    result.sources["sources.list"],
    "deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu.gpg] https://archive.ubuntu.com/ubuntu/ noble-updates main restricted\n",
  );
  assert.equal(
    result.sources["sources.list.d/ubuntu.sources"],
    "Types: deb deb-src\nURIs: https://archive.ubuntu.com/ubuntu http://security.ubuntu.com/ubuntu\nSuites: noble noble-updates\nComponents: main restricted\nSigned-By: /usr/share/keyrings/ubuntu.gpg\n",
  );
  assert.equal(
    result.sources["apt-mirrors.txt"],
    "https://archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu?channel=noble\tpriority:2\nhttps://archive.ubuntu.com/ubuntu/\tpriority:3\nhttp://security.ubuntu.com/ubuntu/\tpriority:4\n",
  );
  assert.equal(
    result.sources["sources.list.d/vendor.list"],
    "deb http://vendor.example/ubuntu noble main\ndeb http://us-west-2.ec2.archive.ubuntu.com/ubuntu noble main\ndeb http://us-east-2.ec2.archive.ubuntu.com.evil.example/ubuntu noble main\ndeb http://us-east-2.ec2.archive.ubuntu.com/ubuntu-extra noble main\n",
  );
  assert.match(
    result.log,
    /pnpm --filter @inside\/web exec playwright install chromium webkit/u,
  );
});

test(
  "Linux fallback replaces all source formats and terminates SIGTERM-resistant children",
  {
    skip: process.platform !== "linux",
  },
  () => {
    const result = spawnSync(
      "bash",
      [
        "scripts/fixtures/playwright-ci-process-tree.sh",
        "scripts/install-playwright-ci.sh",
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  },
);
