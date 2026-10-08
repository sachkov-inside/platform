// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

/** @param {import('node:test').TestContext} t @param {string} failures */
function install(t, failures) {
  const directory = mkdtempSync(join(tmpdir(), "platform-apt-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, "commands");
  const sources = join(directory, "apt");
  mkdirSync(join(sources, "sources.list.d"), { recursive: true });
  const sourceFiles = {
    "sources.list": "deb http://azure.archive.ubuntu.com/ubuntu noble main\n",
    "sources.list.d/ubuntu.sources":
      "URIs: https://azure.archive.ubuntu.com/ubuntu\n",
    "apt-mirrors.txt":
      "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n",
    "sources.list.d/vendor.list":
      "deb http://vendor.example/ubuntu noble main\n",
  };
  for (const [name, content] of Object.entries(sourceFiles)) {
    writeFileSync(join(sources, name), content);
  }
  const stub = `#!/bin/bash
set -eu
echo "$(basename "$0") $*" >> "$INSTALL_TEST_LOG"
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
    if [[ "$count" = 2 ]]; then
      cp -R "$INSTALL_TEST_SOURCES" "$INSTALL_TEST_SOURCES.second"
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
      },
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  assert.ifError(result.error);
  return {
    ...result,
    log: readFileSync(log, "utf8"),
    sources: Object.fromEntries(
      Object.keys(sourceFiles).map((name) => [
        name,
        readFileSync(
          join(first === "0" ? sources : `${sources}.second`, name),
          "utf8",
        ),
      ]),
    ),
  };
}

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
      /sudo find \/etc\/apt .*\.list.*\.sources.*archive\.ubuntu\.com/u,
    );
    assert.ok(result.log.includes("azure[.]archive[.]ubuntu[.]com/ubuntu"));
    assert.ok(result.log.includes("-name apt-mirrors.txt"));
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
