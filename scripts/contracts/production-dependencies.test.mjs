// @ts-check
import assert from "node:assert/strict";
import {
  existsSync,
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { z } from "zod";
import { parse as parseShell } from "shell-quote";
import { packageManifestSchema } from "../package-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** @param {string} path */
const read = (path) => readFileSync(resolve(root, path), "utf8");
/** @typedef {{name:string,parent:string,lines:string[]}} Stage */

/** Follow every FROM and COPY --from edge, including numeric and late identity references.
 * @param {string} source
 */
function graph(source) {
  /** @type {Stage[]} */
  const stages = [];
  /** @type {Stage | undefined} */
  let current;
  for (const line of source
    .replace(/\\\r?\n\s*/gu, " ")
    .split("\n")
    .map((value) => value.trim())) {
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("FROM ")) {
      const match = /^FROM (\S+) AS (\S+)$/u.exec(line);
      assert.ok(match?.[1] && match[2], "every owning stage must be named");
      current = { name: match[2], parent: match[1], lines: [] };
      stages.push(current);
    } else {
      assert.ok(current, "instruction before FROM");
      current.lines.push(line);
    }
  }
  const named = new Map(stages.map((stage) => [stage.name, stage]));
  assert.equal(named.size, stages.length, "duplicate stage name");
  /** @param {string} name */
  function reachable(name) {
    /** @type {Set<string>} */
    const result = new Set();
    /** @type {Set<string>} */
    const pending = new Set();
    /** @param {string} target */
    function visit(target) {
      assert.ok(!pending.has(target), "cyclic Docker stage dependency");
      if (result.has(target)) return;
      const stage = named.get(target);
      assert.ok(stage, `missing stage ${target}`);
      pending.add(target);
      if (named.has(stage.parent)) visit(stage.parent);
      for (const line of stage.lines) {
        if (!line.startsWith("COPY ")) continue;
        const from = /(?:^|\s)--from=(\S+)/u.exec(line)?.[1];
        if (from === undefined) continue;
        const dependency = /^\d+$/u.test(from)
          ? stages[Number(from)]
          : named.get(from);
        assert.ok(dependency, `unknown COPY stage ${from}`);
        visit(dependency.name);
      }
      pending.delete(target);
      result.add(target);
    }
    visit(name);
    return result;
  }
  return { stages, named, reachable };
}

/** @param {string} source */
function productionGraph(source) {
  const parsed = graph(source);
  const runtime = parsed.reachable("backend-production");
  for (const forbidden of ["dependencies", "source", "development"])
    assert.ok(
      !runtime.has(forbidden),
      `production must not acquire full-workspace ${forbidden}`,
    );
  for (const expected of [
    "toolchain",
    "dependency-inputs",
    "production-dependencies",
    "production-source",
    "production-build",
    "release-identity",
  ])
    assert.ok(runtime.has(expected), `production must reach ${expected}`);
  const payload = parsed.reachable("production-build");
  assert.ok(
    !payload.has("release-identity"),
    "identity must remain outside payload compilation",
  );
  for (const name of payload) {
    const stage = parsed.named.get(name);
    assert.ok(stage);
    assert.ok(
      !stage.lines.some((line) =>
        /^ARG INSIDE_(RELEASE_VERSION|SOURCE_SHA)/u.test(line),
      ),
    );
  }
  assert.ok(
    parsed.stages.findIndex(
      (stage) => stage.name === "production-dependencies",
    ) < parsed.stages.findIndex((stage) => stage.name === "release-identity"),
  );
  return parsed;
}

test("backend production follows an isolated dependency graph while every development role keeps the full workspace", () => {
  const source = read("apps/backend/Dockerfile");
  const parsed = productionGraph(source);
  for (const target of [
    "development",
    "migrations",
    "seed",
    "api",
    "mcp",
    "material-assets-worker",
    "profile-avatars-worker",
    "video-deletions-worker",
    "billing-worker",
    "notifications-worker",
    "bank-double",
  ]) {
    const ancestors = parsed.reachable(target);
    assert.ok(
      ancestors.has("dependencies"),
      `${target} needs complete development dependencies`,
    );
    assert.ok(!ancestors.has("production-dependencies"));
  }
  assert.ok(!parsed.reachable("api-production").has("dependencies"));
  const web = graph(read("apps/web/Dockerfile"));
  for (const target of [
    "development",
    "web",
    "storybook",
    "production-build",
    "web-production",
    "release-identity",
  ])
    assert.ok(
      web.reachable(target).has("dependencies"),
      `Web ${target} keeps the full workspace`,
    );
  for (const file of ["apps/backend/Dockerfile", "apps/web/Dockerfile"]) {
    const shared = graph(read(file)).named.get("dependencies");
    assert.ok(shared);
    assert.equal(shared.parent, "dependency-inputs");
    assert.deepEqual(shared.lines, [
      "RUN --mount=type=cache,id=inside-platform-pnpm,target=/pnpm/store,uid=1000,gid=1000  pnpm install --frozen-lockfile --store-dir=/pnpm/store --package-import-method=copy",
    ]);
  }
  for (const [name, owner] of [
    ["source", "dependencies"],
    ["production-source", "production-dependencies"],
  ]) {
    assert.ok(name && owner);
    const stage = parsed.named.get(name);
    assert.ok(stage);
    assert.equal(stage.parent, owner);
    assert.deepEqual(stage.lines, [
      "COPY --chown=node:node . .",
      `COPY --from=${owner} --chown=node:node /workspace/patches ./patches`,
      "ENV TBANK_CA_FILE=/workspace/infra/tls/russian-trusted-root-ca.pem",
    ]);
  }
});

test("production reachability rejects full workspace paths through every parent, COPY and late identity edge", () => {
  const source = read("apps/backend/Dockerfile");
  const parsed = productionGraph(source);
  const dependencyIndex = parsed.stages.findIndex(
    (stage) => stage.name === "dependencies",
  );
  const mutants = [
    source.replace(
      "FROM dependency-inputs AS production-dependencies",
      "FROM dependencies AS production-dependencies",
    ),
    source.replace(
      "FROM production-source AS production-build",
      "FROM source AS production-build",
    ),
    source.replace(
      "FROM production-dependencies AS release-identity",
      "FROM dependencies AS release-identity",
    ),
    source.replace(
      "FROM production-dependencies AS production-source",
      "FROM production-dependencies AS production-source\nCOPY --from=dependencies /workspace/patches /private-copy",
    ),
    source.replace(
      "FROM production-dependencies AS release-identity",
      "FROM production-dependencies AS release-identity\nCOPY --from=dependencies /workspace/package.json /private-copy",
    ),
    source.replace(
      "FROM production-dependencies AS release-identity",
      `FROM production-dependencies AS release-identity\nCOPY --from=${dependencyIndex} /workspace/package.json /private-copy`,
    ),
  ];
  for (const [index, mutant] of mutants.entries()) {
    assert.notEqual(mutant, source);
    assert.throws(
      () => productionGraph(mutant),
      /production must not acquire full-workspace/u,
      `dependency edge ${index}`,
    );
  }
});

/** Execute only the reviewed Docker RUN, with task-owned pnpm/mktemp/rm doubles.
 * No package manager, install, network or Docker command executes on the host.
 * @param {{install:number,cleanup:number,temporary:number}} status
 */
function installRun(status) {
  const stage = graph(read("apps/backend/Dockerfile")).named.get(
    "production-dependencies",
  );
  assert.ok(stage);
  assert.equal(
    stage.lines.length,
    1,
    "private install and cleanup must occupy one RUN",
  );
  const instruction = stage.lines[0];
  assert.ok(instruction);
  assert.ok(instruction?.startsWith("RUN set -eu;"));
  assert.ok(
    !instruction.includes("--mount"),
    "private production store must not be a cache/bind mount",
  );
  const directory = mkdtempSync(join(tmpdir(), "inside-production-install-"));
  const store = join(directory, "private store");
  const foreign = join(directory, "foreign-store");
  writeFileSync(foreign, "foreign-cache-sentinel");
  try {
    writeFileSync(
      join(directory, "mktemp"),
      `#!/bin/sh
set -eu
printf '%s\n' "$@" > "$INSIDE_INSTALL_TEST_ROOT/mktemp.args"
[ "$#" -eq 2 ] && [ "$1" = '-d' ] && [ "$2" = '/tmp/inside-backend-pnpm.XXXXXX' ] || exit 90
[ "$INSIDE_INSTALL_TEST_TEMP_STATUS" -eq 0 ] || exit "$INSIDE_INSTALL_TEST_TEMP_STATUS"
mkdir -m 700 -- "$INSIDE_INSTALL_TEST_ROOT/private store"
printf '%s\n' "$INSIDE_INSTALL_TEST_ROOT/private store"
`,
      { mode: 0o700 },
    );
    writeFileSync(
      join(directory, "pnpm"),
      `#!/bin/sh
set -eu
printf '%s\n' "$@" > "$INSIDE_INSTALL_TEST_ROOT/pnpm.args"
[ -d "$INSIDE_INSTALL_TEST_ROOT/private store" ] || exit 91
printf 'owned-store' > "$INSIDE_INSTALL_TEST_ROOT/private store/content"
printf 'installed-copy' > "$INSIDE_INSTALL_TEST_ROOT/installed-copy"
exit "$INSIDE_INSTALL_TEST_INSTALL_STATUS"
`,
      { mode: 0o700 },
    );
    writeFileSync(
      join(directory, "rm"),
      `#!/bin/sh
set -eu
printf '%s\n' "$@" > "$INSIDE_INSTALL_TEST_ROOT/rm.args"
[ "$#" -eq 3 ] && [ "$1" = '-rf' ] && [ "$2" = '--' ] && [ "$3" = "$INSIDE_INSTALL_TEST_ROOT/private store" ] || exit 92
[ "$INSIDE_INSTALL_TEST_CLEANUP_STATUS" -eq 0 ] || exit "$INSIDE_INSTALL_TEST_CLEANUP_STATUS"
# Only the exact test-created private path can reach the real removal command.
/bin/rm -rf -- "$INSIDE_INSTALL_TEST_ROOT/private store"
`,
      { mode: 0o700 },
    );
    const result = spawnSync("sh", ["-c", instruction.slice(4)], {
      env: {
        ...process.env,
        PATH: directory + ":" + (process.env["PATH"] ?? ""),
        TMPDIR: foreign,
        backend_store: foreign,
        INSIDE_INSTALL_TEST_ROOT: directory,
        INSIDE_INSTALL_TEST_INSTALL_STATUS: String(status.install),
        INSIDE_INSTALL_TEST_CLEANUP_STATUS: String(status.cleanup),
        INSIDE_INSTALL_TEST_TEMP_STATUS: String(status.temporary),
      },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(readFileSync(foreign, "utf8"), "foreign-cache-sentinel");
    /** @param {string} name */
    const args = (name) =>
      existsSync(join(directory, name + ".args"))
        ? readFileSync(join(directory, name + ".args"), "utf8")
            .trim()
            .split("\n")
        : [];
    assert.deepEqual(args("mktemp"), ["-d", "/tmp/inside-backend-pnpm.XXXXXX"]);
    if (status.temporary !== 0) {
      assert.deepEqual(args("pnpm"), []);
      assert.deepEqual(args("rm"), []);
      assert.equal(result.status, status.temporary);
    } else {
      assert.deepEqual(args("pnpm"), [
        "install",
        "--frozen-lockfile",
        `--store-dir=${store}`,
        "--package-import-method=copy",
        "--filter",
        "@inside/backend...",
      ]);
      assert.deepEqual(args("rm"), ["-rf", "--", store]);
      assert.equal(
        readFileSync(join(directory, "installed-copy"), "utf8"),
        "installed-copy",
      );
      assert.equal(existsSync(store), status.cleanup !== 0);
      assert.equal(result.status, status.install || status.cleanup);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// deterministic-test-allow unit-io: bounded shell execution uses only task-owned command doubles and private temporary files; no install, Docker or providers.
test("the private RUN store ignores ambient paths and cleanup preserves the original failure", () => {
  for (const status of [
    { install: 0, cleanup: 0, temporary: 0 },
    { install: 19, cleanup: 0, temporary: 0 },
    { install: 0, cleanup: 23, temporary: 0 },
    { install: 19, cleanup: 23, temporary: 0 },
    { install: 0, cleanup: 0, temporary: 37 },
  ])
    installRun(status);
});

test("the isolated install supplies every declared backend and root workspace dependency before lifecycle scripts", () => {
  const schema = packageManifestSchema.extend({
    name: z.string(),
    optionalDependencies: z.record(z.string(), z.string()).default({}),
  });
  /** @type {Map<string,{path:string,dependencies:Record<string,string>}>} */
  const projects = new Map();
  for (const path of [
    "package.json",
    ...globSync(
      [
        "apps/*/package.json",
        "packages/*/package.json",
        "docs/contracts/package.json",
      ],
      { cwd: root },
    ),
  ]) {
    const manifest = schema.parse(JSON.parse(read(path)));
    projects.set(manifest.name, {
      path,
      dependencies: {
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.optionalDependencies,
      },
    });
  }
  // The pinned pnpm backend... selector also retains the root tooling importer.
  const pending = ["@inside/backend", "@inside/platform"];
  /** @type {Set<string>} */
  const selected = new Set();
  while (pending.length > 0) {
    const name = pending.pop();
    assert.ok(name);
    if (selected.has(name)) continue;
    selected.add(name);
    const project = projects.get(name);
    assert.ok(project, `missing workspace importer ${name}`);
    for (const [dependency, version] of Object.entries(project.dependencies))
      if (version.startsWith("workspace:")) pending.push(dependency);
  }
  assert.deepEqual([...selected].sort(), [
    "@inside/access-capabilities",
    "@inside/backend",
    "@inside/contracts",
    "@inside/legal",
    "@inside/material-blocks",
    "@inside/platform",
    "@inside/runtime-identity",
  ]);
  const inputs = graph(read("apps/backend/Dockerfile")).named.get(
    "dependency-inputs",
  );
  assert.ok(inputs);
  const copied = inputs.lines
    .filter((line) => line.startsWith("COPY "))
    .flatMap((line) =>
      z
        .array(z.string())
        .parse(parseShell(line))
        .slice(1)
        .filter((word) => !word.startsWith("--"))
        .slice(0, -1),
    );
  for (const name of selected) {
    const project = projects.get(name);
    assert.ok(project);
    assert.ok(
      copied.some(
        (source) =>
          project.path === source || project.path.startsWith(source + "/"),
      ),
      `missing source for ${name}`,
    );
  }
  for (const source of [
    "packages/material-blocks",
    "packages/legal",
    "packages/access-capabilities",
    "docs/contracts",
  ])
    assert.ok(
      copied.includes(source),
      `${source} needs its complete build inputs before postinstall`,
    );
});
