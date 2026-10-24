// @ts-check
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  globSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runOwnedProcess } from "../observability-umami/process-owner.mjs";
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
      const parent = /^\d+$/u.test(stage.parent)
        ? stages[Number(stage.parent)]
        : named.get(stage.parent);
      if (parent !== undefined) visit(parent.name);
      else
        assert.ok(!/^\d+$/u.test(stage.parent), "unknown numeric FROM stage");
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
  for (const forbidden of [
    "dependencies",
    "source",
    "development",
    "production-dependencies",
    "production-source",
  ])
    assert.ok(
      !runtime.has(forbidden),
      `production must not acquire full-workspace ${forbidden}`,
    );
  for (const expected of [
    "toolchain",
    "dependency-inputs",
    "production-build",
    "release-identity",
  ])
    assert.ok(runtime.has(expected), `production must reach ${expected}`);
  assert.deepEqual(
    [...runtime].sort(),
    [
      "backend-production",
      "dependency-inputs",
      "production-build",
      "release-identity",
      "toolchain",
    ].sort(),
  );
  assert.equal(
    parsed.named.get("production-build")?.parent,
    "dependency-inputs",
  );
  assert.equal(
    parsed.named.get("release-identity")?.parent,
    "production-build",
  );
  assert.ok(parsed.named.has("production-dependencies"));
  assert.ok(parsed.named.has("production-source"));
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
    parsed.stages.findIndex((stage) => stage.name === "production-build") <
      parsed.stages.findIndex((stage) => stage.name === "release-identity"),
  );
  return parsed;
}

test("production payload and late identity both exclude retained installed-dependency ancestors", () => {
  const parsed = graph(read("apps/backend/Dockerfile"));
  for (const target of ["backend-production", "api-production"]) {
    const ancestors = parsed.reachable(target);
    for (const forbidden of [
      "dependencies",
      "source",
      "development",
      "production-dependencies",
      "production-source",
    ])
      assert.ok(
        !ancestors.has(forbidden),
        `${target} retains installed ancestor ${forbidden}`,
      );
  }
  assert.equal(
    parsed.named.get("production-build")?.parent,
    "dependency-inputs",
  );
  assert.equal(
    parsed.named.get("release-identity")?.parent,
    "production-build",
  );
  for (const retained of ["production-dependencies", "production-source"])
    assert.ok(
      parsed.named.has(retained),
      `direct target ${retained} disappeared`,
    );
});

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

test("production reachability rejects retained installs, numeric edges, aliases and early release inputs", () => {
  const source = read("apps/backend/Dockerfile");
  const parsed = productionGraph(source);
  const legacyIndex = parsed.stages.findIndex(
    (stage) => stage.name === "production-dependencies",
  );
  const mutants = [
    ...[
      "dependencies",
      "source",
      "production-dependencies",
      "production-source",
      String(legacyIndex),
    ].map((parent) =>
      source.replace(
        "FROM dependency-inputs AS production-build",
        `FROM ${parent} AS production-build`,
      ),
    ),
    ...["dependencies", "production-dependencies", "production-source"].map(
      (parent) =>
        source.replace(
          "FROM production-build AS release-identity",
          `FROM ${parent} AS release-identity`,
        ),
    ),
    source.replace(
      "FROM production-build AS release-identity",
      `FROM production-build AS release-identity\nCOPY --from=${legacyIndex} /workspace/package.json /private-copy`,
    ),
    source.replace(
      "FROM dependency-inputs AS production-build",
      "FROM dependency-inputs AS production-build\nCOPY --from=production-dependencies /workspace/patches /private-copy",
    ),
    source.replace(
      "FROM dependency-inputs AS production-build",
      "FROM production-dependencies AS hidden-installed\nFROM hidden-installed AS production-build",
    ),
    source.replace(
      "FROM dependency-inputs AS production-build",
      "FROM dependency-inputs AS hidden-payload\nFROM hidden-payload AS production-build",
    ),
    source.replace(
      "FROM dependency-inputs AS production-build",
      "FROM dependency-inputs AS production-build\nARG INSIDE_RELEASE_VERSION",
    ),
  ];
  for (const [index, mutant] of mutants.entries()) {
    assert.notEqual(mutant, source);
    assert.throws(
      () => productionGraph(mutant),
      Error,
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

const moduleRoots = [
  "node_modules",
  "apps/backend/node_modules",
  "docs/contracts/node_modules",
  "packages/access-capabilities/node_modules",
  "packages/legal/node_modules",
  "packages/material-blocks/node_modules",
  "packages/runtime-identity/node_modules",
];
const packageParents = [
  "apps/backend",
  "docs/contracts",
  "packages/access-capabilities",
  "packages/legal",
  "packages/material-blocks",
  "packages/runtime-identity",
];
/** @param {string} source */
function fusedInstruction(source) {
  const stage = productionGraph(source).named.get("production-build");
  assert.ok(stage);
  assert.deepEqual(stage.lines.slice(0, 2), [
    "COPY --chown=node:node . .",
    "ENV TBANK_CA_FILE=/workspace/infra/tls/russian-trusted-root-ca.pem",
  ]);
  const runs = stage.lines.filter((line) => line.startsWith("RUN "));
  assert.equal(runs.length, 1);
  const run = runs[0];
  assert.ok(run);
  assert.ok(!run.includes("--mount"));
  const install =
    "pnpm install --frozen-lockfile --store-dir=\"$backend_store\" --package-import-method=copy --filter '@inside/backend...'";
  const compile = "pnpm --filter @inside/backend build:production";
  const deploy =
    'pnpm --store-dir="$deploy_store" --config.inject-workspace-packages=true --filter @inside/backend deploy --prod --ignore-scripts /workspace/.production/backend';
  const removal =
    "rm -rf -- " + moduleRoots.map((path) => "/workspace/" + path).join(" ");
  for (const text of [install, compile, deploy, removal])
    assert.ok(run.includes(text), "fixed fused command changed");
  assert.ok(run.indexOf(install) < run.indexOf(compile));
  assert.ok(run.indexOf(compile) < run.indexOf(deploy));
  assert.ok(run.indexOf(deploy) < run.indexOf(removal));
  assert.equal([...run.matchAll(/\brm -rf -- /gu)].length, 3);
  const actualRemoval = /rm -rf -- (\/workspace\/[^;]+);/u.exec(run)?.[1];
  assert.deepEqual(
    actualRemoval?.trim().split(/\s+/u),
    moduleRoots.map((path) => "/workspace/" + path),
  );
  return run.slice(4);
}

// This whole command implementation is test-owned. It never invokes a package manager.
const fixtureCommand =
  String.raw`
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const {lstatSync,readdirSync,readFileSync,readlinkSync}=fs, {join}=path, {createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const root = process.env.INSIDE_FUSED_FIXTURE;
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const workspace = path.join(root, 'workspace');
const modules = ['node_modules','apps/backend/node_modules','docs/contracts/node_modules','packages/access-capabilities/node_modules','packages/legal/node_modules','packages/material-blocks/node_modules','packages/runtime-identity/node_modules'];
const command = path.basename(process.argv[1]), args = process.argv.slice(2);
const log = event => fs.appendFileSync(path.join(root,'journal.jsonl'), JSON.stringify({event, args})+'\n');
const bail = code => process.exit(code);
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const mkdir = p => fs.mkdirSync(p,{recursive:true});
const foreign = p => { mkdir(p);fs.writeFileSync(path.join(p,'foreign-sentinel'),'foreign-preserved'); };
function replace(p,link=false) {
 const saved=path.join(root,'held-'+path.relative(workspace,p).replaceAll('/','-'));
 fs.renameSync(p,saved);
 if(link) fs.symlinkSync(saved,p); else { foreign(p); fs.cpSync(saved,p,{recursive:true,dereference:false}); }
}
function mutate(boundary) {
 if(config.fault === boundary+'_parent_dir')replace(path.join(workspace,'.production'));
 if(config.fault === boundary+'_parent_link')replace(path.join(workspace,'.production'),true);
 if(config.fault === boundary+'_parent_alias_root'){
  const parent=path.join(workspace,'.production');fs.renameSync(parent,path.join(root,'held-production'));fs.symlinkSync(path.join(workspace,'node_modules'),parent);
 }
 if(boundary==='compile' && config.fault?.startsWith('replace_root_'))replace(path.join(workspace,modules[Number(config.fault.slice('replace_root_'.length))]));
 if(boundary==='compile' && config.fault?.startsWith('link_root_'))replace(path.join(workspace,modules[Number(config.fault.slice('link_root_'.length))]),true);
 if(boundary==='compile' && config.fault==='link_packages_parent')replace(path.join(workspace,'packages'),true);
}
if(command==='id') {
 log('id');if(config.fault==='id_failure')bail(43);if(config.fault==='id_malformed'){process.stdout.write('01\n');bail(0);}
 if(!equal(args,['-u']))bail(91);process.stdout.write(String(process.getuid())+'\n');bail(0);
}
if(command==='mktemp') {
 log('mktemp');if(!equal(args,['-d','/tmp/inside-backend-pnpm.XXXXXX']))bail(91);
 if(config.temporary)bail(config.temporary);const store=path.join(root,'private store');fs.mkdirSync(store,{mode:0o700});process.stdout.write(store+'\n');bail(0);
}
if(command==='stat') {
 if(args.length!==4 || args[0]!=='-c' || !['%d:%i','%d:%i:%u','%a'].includes(args[1]) || args[2]!=='--')bail(91);
 const target=args[3]; if(!target.startsWith(workspace) && target!==root && target!==path.join(root,'deploy-private'))bail(91);
 if(target===path.join(root,'deploy-private') && config.fault==='deploy_store_stat_failure' && fs.existsSync(path.join(root,'deployed')))bail(47);
 log('stat'); if(config.fault==='stat_missing')bail(127);
 const info=fs.lstatSync(target,{bigint:true});
 const countPath=path.join(root,'stat-counts.json'), counts=fs.existsSync(countPath)?JSON.parse(fs.readFileSync(countPath,'utf8')):{};
 counts[target]=(counts[target]??0)+1;fs.writeFileSync(countPath,JSON.stringify(counts));
 const n=counts[target], late=config.stage==='identity';
 let uid=info.uid;
 if(config.fault==='owner_mismatch' || config.fault==='owner_after_compile' && fs.existsSync(path.join(root,'compiled')))uid+=1n;
 const offset=late && config.shiftStage?1000000000n:0n;
 if(target===path.join(root,'deploy-private') && config.fault==='deploy_store_owner')uid+=1n;
 const result=args[1]==='%a'?(Number(info.mode)&0o7777).toString(8):[info.dev+offset,info.ino+offset,...args[1]==='%d:%i:%u'?[uid]:[]].join(':');
 if(config.fault==='stat_malformed')process.stdout.write('1:02:bad\n'); else process.stdout.write(result+'\n');
 if(config.fault==='stat_failed_after_output')bail(47);
 if(!late && target===path.join(workspace,'.production/backend') && config.fault==='replace_payload' && n===1){replace(target);mkdir(path.join(target,'node_modules'));fs.writeFileSync(path.join(target,'package.json'),'{}');}
 if(!late && target===path.join(workspace,'.production/backend/node_modules') && config.fault==='replace_payload_modules' && n===1)replace(target);
 if(!late && target===path.join(workspace,'.production/backend/node_modules') && config.fault==='link_payload_modules' && n===1)replace(target,true);
 if(!late && target===path.join(workspace,'.production/backend') && config.fault==='alias_payload_root' && n===1){fs.renameSync(target,path.join(root,'held-backend'));fs.symlinkSync(path.join(workspace,'node_modules'),target);}
 if(late && n===1 && target===path.join(workspace,'.production') && config.fault==='identity_parent_dir')replace(target);
 if(late && n===1 && target===path.join(workspace,'.production') && config.fault==='identity_parent_link')replace(target,true);
 if(late && n===1 && target===path.join(workspace,'.production/backend') && config.fault==='identity_payload_link')replace(target,true);
 if(late && n===1 && target===path.join(workspace,'.production/backend/node_modules') && config.fault==='identity_modules_dir')replace(target);
 bail(0);
}
if(command==='rm') {
 const deployStore=['-rf','--',path.join(root,'deploy-private')];
 const store=['-rf','--',path.join(root,'private store')], roots=['-rf','--',...modules.map(p=>path.join(workspace,p))];
 if(equal(args,store)){log('remove_store');if(config.storeCleanup)bail(config.storeCleanup);}
 else if(equal(args,deployStore)){log('remove_deploy_store');if(config.deployStoreCleanup)bail(config.deployStoreCleanup);const payload=path.join(workspace,'.production/backend');if(fs.existsSync(payload))fs.writeFileSync(path.join(root,'payload-before-store.json'),JSON.stringify(payloadTree(payload)));}
 else if(equal(args,roots)){log('remove_modules');fs.writeFileSync(path.join(root,'payload-before.json'),JSON.stringify(payloadTree(path.join(workspace,'.production/backend'))));if(config.modulesCleanup)bail(config.modulesCleanup);}
 else bail(92);
 const r=cp.spawnSync('/bin/rm',args,{stdio:'ignore'});bail(r.status??93);
}
if(command==='pnpm') {
 if(args[0]==='install') {
  log('install');const store=path.join(root,'private store');
  if(!equal(args,['install','--frozen-lockfile','--store-dir='+store,'--package-import-method=copy','--filter','@inside/backend...']))bail(91);
  if(!fs.existsSync(store))bail(91);fs.writeFileSync(path.join(store,'content'),'owned-store');
  for(const p of modules)mkdir(path.join(workspace,p));
  fs.writeFileSync(path.join(workspace,'node_modules/native.bin'),'native-fixture',{mode:0o755});
  fs.symlinkSync(path.join(root,'foreign-data'),path.join(workspace,'node_modules/foreign-link'));
  bail(config.install??0);
 }
 if(equal(args,['--filter','@inside/backend','build:production'])) {
  log('compile');if(!fs.existsSync(path.join(workspace,'node_modules/native.bin')) || fs.existsSync(path.join(root,'private store')))bail(94);
  mkdir(path.join(workspace,'apps/backend/dist'));fs.writeFileSync(path.join(workspace,'apps/backend/dist/main.js'),'compiled-fixture');fs.writeFileSync(path.join(root,'compiled'),'yes');mutate('compile');bail(config.compile??0);
 }
 const deployStoreFlag='--store-dir='+path.join(root,'deploy-private');
 const deployArgs=args.filter(arg=>arg!==deployStoreFlag);
 if(equal(deployArgs,['--config.inject-workspace-packages=true','--filter','@inside/backend','deploy','--prod','--ignore-scripts',path.join(workspace,'.production/backend')])) {
  log('deploy');const store=args.includes(deployStoreFlag)?path.join(root,'deploy-private'):path.join(root,'deploy-store');
  if(args.includes(deployStoreFlag) && !fs.existsSync(store))bail(91);
  mkdir(store);fs.writeFileSync(path.join(store,'cafs.bin'),'deploy-cafs-fixture');
  fs.writeFileSync(path.join(root,'deployed'),'yes');
  if(config.deploy)bail(config.deploy);const payload=path.join(workspace,'.production/backend');
  fs.mkdirSync(payload);mkdir(path.join(payload,'node_modules'));
  fs.writeFileSync(path.join(payload,'package.json'),'{}\n',{mode:0o644});
  fs.linkSync(path.join(workspace,'node_modules/native.bin'),path.join(payload,'node_modules/native.bin'));
  fs.linkSync(path.join(store,'cafs.bin'),path.join(payload,'node_modules/cafs.bin'));
  fs.symlinkSync('native.bin',path.join(payload,'node_modules/portable-link'));
  if(config.externalPayloadLink)fs.symlinkSync(path.join(workspace,'node_modules/native.bin'),path.join(payload,'node_modules/escape-link'));
  if(config.externalStoreLink)fs.symlinkSync(path.join(store,'cafs.bin'),path.join(payload,'node_modules/store-escape-link'));
  if(config.zodSource)fs.cpSync(config.zodSource,path.join(payload,'node_modules/zod'),{recursive:true});
  if(config.fault==='deploy_store_directory')replace(store);
  if(config.fault==='deploy_store_link')replace(store,true);
  if(config.fault==='deploy_store_payload_alias'){fs.renameSync(store,path.join(root,'held-deploy-store'));fs.symlinkSync(payload,store);}
  if(config.fault==='deploy_store_mode')fs.chmodSync(store,0o777);
  mutate('deploy');bail(0);
 }
 bail(91);
}
if(command==='node') {
 log('identity_writer');const r=cp.spawnSync(process.execPath,args,{stdio:'ignore'});bail(r.status??93);
}
bail(91);
` +
  "\n" +
  payloadTree.toString();

/** @param {string} value */
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
/** @typedef {{install?:number|undefined,storeCleanup?:number|undefined,deployStoreCleanup?:number|undefined,temporary?:number|undefined,compile?:number|undefined,deploy?:number|undefined,modulesCleanup?:number|undefined,fault?:string,stage?:string,shiftStage?:boolean,zodSource?:string,externalPayloadLink?:boolean,externalStoreLink?:boolean,release?:string,sourceSha?:string}} FusedConfig */
/** @param {(fixture:{directory:string,workspace:string,bin:string,run:(config?:FusedConfig,identity?:boolean)=>ReturnType<typeof runOwnedProcess>,events:()=>string[]})=>Promise<void>} action */
async function withFusedFixture(action) {
  const created = mkdtempSync(join(tmpdir(), "inside-fused-contract-"));
  /** @type {unknown} */ let primary;
  let failed = false;
  try {
    const directory = realpathSync(created),
      workspace = join(directory, "workspace"),
      bin = join(directory, "bin");
    mkdirSync(workspace);
    mkdirSync(bin);
    mkdirSync(join(directory, "deploy-store"));
    writeFileSync(
      join(directory, "deploy-store/sentinel"),
      "deploy-store-unchanged",
    );
    mkdirSync(join(directory, "foreign-data"));
    writeFileSync(
      join(directory, "foreign-data/sentinel"),
      "foreign-preserved",
    );
    for (const parent of packageParents)
      mkdirSync(join(workspace, parent), { recursive: true });
    mkdirSync(join(workspace, "infra/tls"), { recursive: true });
    writeFileSync(
      join(workspace, "infra/tls/russian-trusted-root-ca.pem"),
      "fixture-ca",
    );
    for (const command of ["pnpm", "stat", "id", "mktemp", "rm", "node"])
      writeFileSync(
        join(bin, command),
        "#!" + process.execPath + "\n" + fixtureCommand,
        { mode: 0o700 },
      );
    for (const name of [
      "package.json",
      "index.mjs",
      "write-release-identity.mjs",
    ])
      copyFileSync(
        join(root, "packages/runtime-identity", name),
        join(workspace, "packages/runtime-identity", name),
      );
    /** @param {FusedConfig} [config] @param {boolean} [identity] */
    const run = async (config = {}, identity = false) => {
      writeFileSync(
        join(directory, "config.json"),
        JSON.stringify({ ...config, stage: identity ? "identity" : "build" }),
      );
      rmSync(join(directory, "stat-counts.json"), { force: true });
      const stage = graph(read("apps/backend/Dockerfile")).named.get(
        "release-identity",
      );
      assert.ok(stage);
      const instruction = identity
        ? stage.lines.find((line) => line.startsWith("RUN "))?.slice(4)
        : fusedInstruction(read("apps/backend/Dockerfile"));
      assert.ok(instruction);
      // Relocate the only new absolute store literal, never the host /tmp or old mktemp template.
      const relocated = instruction
        .replaceAll("/workspace", workspace)
        .replaceAll(
          "/tmp/inside-backend-deploy-store",
          join(directory, "deploy-private"),
        );
      assert.ok(!relocated.includes("/tmp/inside-backend-deploy-store"));
      return await runOwnedProcess(
        "env",
        [
          "PATH=" + bin + ":/usr/bin:/bin",
          "INSIDE_FUSED_FIXTURE=" + directory,
          "backend_store=" + join(directory, "foreign-data"),
          "TMPDIR=" + join(directory, "foreign-data"),
          "INSIDE_RELEASE_VERSION=" + (config.release ?? "v123"),
          "INSIDE_SOURCE_SHA=" + (config.sourceSha ?? "a".repeat(40)),
          "sh",
          "-c",
          "cd " + quote(workspace) + "; " + relocated,
        ],
        { timeoutMs: 5000 },
      );
    };
    const events = () =>
      existsSync(join(directory, "journal.jsonl"))
        ? readFileSync(join(directory, "journal.jsonl"), "utf8")
            .trim()
            .split("\n")
            .map(
              (line) =>
                z.object({ event: z.string() }).parse(JSON.parse(line)).event,
            )
        : [];
    await action({ directory, workspace, bin, run, events });
  } catch (error) {
    primary = error;
    failed = true;
  } finally {
    try {
      rmSync(created, { recursive: true, force: true });
    } catch (error) {
      if (!failed) {
        primary = error;
        failed = true;
      }
    }
  }
  if (failed) throw primary;
}

// deterministic-test-allow unit-io: existing outside process owner bounds/reaps private relocated shell commands and child tools; pnpm is an unconditionally test-owned double and removals use real private filesystem paths.
test("fused RUN settles original command status before real seven-root removal and preserves portable payload", async () => {
  for (const [config, status, order] of [
    [{}, 0, ["install", "remove_store", "compile", "deploy", "remove_modules"]],
    [{ install: 19, storeCleanup: 23 }, 19, ["install", "remove_store"]],
    [{ storeCleanup: 23 }, 23, ["install", "remove_store"]],
    [{ temporary: 37 }, 37, []],
    [{ compile: 41 }, 41, ["install", "remove_store", "compile"]],
    [{ deploy: 43 }, 43, ["install", "remove_store", "compile", "deploy"]],
    [
      { modulesCleanup: 53 },
      53,
      ["install", "remove_store", "compile", "deploy", "remove_modules"],
    ],
  ]) {
    assert.ok(typeof status === "number" && Array.isArray(order));
    await withFusedFixture(async (fixture) => {
      const value = z
        .object({
          install: z.number().optional(),
          storeCleanup: z.number().optional(),
          temporary: z.number().optional(),
          compile: z.number().optional(),
          deploy: z.number().optional(),
          modulesCleanup: z.number().optional(),
        })
        .parse(config);
      const result = await fixture.run(value);
      assert.equal(result.reason, "exit");
      assert.equal(result.code, status, result.stderr);
      assert.deepEqual(
        fixture
          .events()
          .filter((event) =>
            [
              "install",
              "remove_store",
              "compile",
              "deploy",
              "remove_modules",
            ].includes(event),
          ),
        order,
      );
      assert.equal(
        readFileSync(join(fixture.directory, "foreign-data/sentinel"), "utf8"),
        "foreign-preserved",
      );
      if (status === 0) {
        for (const path of moduleRoots)
          assert.ok(!existsSync(join(fixture.workspace, path)));
        const payload = join(
          fixture.workspace,
          ".production/backend/node_modules",
        );
        assert.equal(
          readFileSync(join(payload, "native.bin"), "utf8"),
          "native-fixture",
        );
        assert.equal(
          lstatSync(join(payload, "native.bin")).mode & 0o777,
          0o755,
        );
        assert.equal(
          readlinkSync(join(payload, "portable-link")),
          "native.bin",
        );
        assert.equal(
          realpathSync(join(payload, "portable-link")),
          join(payload, "native.bin"),
        );
        assert.equal(
          readFileSync(
            join(fixture.workspace, "apps/backend/dist/main.js"),
            "utf8",
          ),
          "compiled-fixture",
        );
        assert.equal(
          readFileSync(
            join(fixture.workspace, "infra/tls/russian-trusted-root-ca.pem"),
            "utf8",
          ),
          "fixture-ca",
        );
        assert.equal(
          readFileSync(
            join(fixture.directory, "deploy-store/sentinel"),
            "utf8",
          ),
          "deploy-store-unchanged",
        );
      } else if (value.temporary === undefined)
        for (const path of moduleRoots)
          assert.ok(existsSync(join(fixture.workspace, path)));
    });
  }
});

// deterministic-test-allow unit-io: the real relocated RUN owns its private store while pnpm is a bounded command double; real hardlinks prove cleanup does not remove payload bytes.
test("deploy CAFS is private and removed without mutating the default store or hardlinked payload", async () => {
  await withFusedFixture(async (fixture) => {
    const result = await fixture.run();
    assert.equal(result.reason, "exit");
    assert.equal(result.code, 0, result.stderr);
    assert.ok(!existsSync(join(fixture.directory, "deploy-private")));
    assert.ok(!existsSync(join(fixture.directory, "deploy-store/cafs.bin")));
    assert.equal(
      readFileSync(join(fixture.directory, "deploy-store/sentinel"), "utf8"),
      "deploy-store-unchanged",
    );
    assert.equal(
      readFileSync(
        join(fixture.workspace, ".production/backend/node_modules/cafs.bin"),
        "utf8",
      ),
      "deploy-cafs-fixture",
    );
    assert.deepEqual(
      payloadTree(join(fixture.workspace, ".production/backend")),
      JSON.parse(
        readFileSync(
          join(fixture.directory, "payload-before-store.json"),
          "utf8",
        ),
      ),
    );
    assertPortablePayload(join(fixture.workspace, ".production/backend"));
  });
});

// deterministic-test-allow unit-io: existing outside process owner bounds the extracted RUN; private real rm fault controls observe settled deploy status and prevent later module cleanup.
test("private deploy cleanup settles failure without hiding the original deploy status", async () => {
  for (const [deploy, deployStoreCleanup, expected] of [
    [43, 0, 43],
    [0, 47, 47],
    [43, 47, 43],
  ])
    await withFusedFixture(async (fixture) => {
      const result = await fixture.run({ deploy, deployStoreCleanup });
      assert.equal(result.reason, "exit");
      assert.equal(result.code, expected, result.stderr);
      assert.ok(fixture.events().includes("remove_deploy_store"));
      assert.ok(!fixture.events().includes("remove_modules"));
      assert.equal(
        existsSync(join(fixture.directory, "deploy-private")),
        deployStoreCleanup !== 0,
      );
      assert.ok(!existsSync(join(fixture.directory, "deploy-store/cafs.bin")));
      for (const path of moduleRoots)
        assert.ok(existsSync(join(fixture.workspace, path)));
    });
});

// deterministic-test-allow unit-io: preexisting collisions and real directory/link/mode substitutions remain under the constructor-owned fixture; stat failures use the existing finite command fault port.
test("private deploy store never adopts collisions or removes a substituted root", async () => {
  for (const kind of ["directory", "file", "link", "dangling"])
    await withFusedFixture(async (fixture) => {
      const target = join(fixture.directory, "deploy-private");
      if (kind === "directory") {
        mkdirSync(target);
        writeFileSync(join(target, "sentinel"), "foreign-store");
      } else if (kind === "file") writeFileSync(target, "foreign-store");
      else
        symlinkSync(
          join(fixture.directory, kind === "link" ? "foreign-data" : "missing"),
          target,
        );
      const before = lstatSync(target),
        link = before.isSymbolicLink() ? readlinkSync(target) : undefined;
      const result = await fixture.run();
      assert.equal(result.reason, "exit");
      assert.notEqual(result.code, 0);
      assert.ok(!fixture.events().includes("deploy"));
      assert.ok(!fixture.events().includes("remove_deploy_store"));
      assert.ok(!fixture.events().includes("remove_modules"));
      assert.equal(lstatSync(target).ino, before.ino);
      if (link !== undefined) assert.equal(readlinkSync(target), link);
      else
        assert.equal(
          readFileSync(
            kind === "directory" ? join(target, "sentinel") : target,
            "utf8",
          ),
          "foreign-store",
        );
    });
  for (const fault of [
    "deploy_store_owner",
    "deploy_store_stat_failure",
    "deploy_store_directory",
    "deploy_store_link",
    "deploy_store_payload_alias",
    "deploy_store_mode",
  ])
    await withFusedFixture(async (fixture) => {
      const result = await fixture.run({ fault });
      assert.equal(result.reason, "exit");
      assert.notEqual(result.code, 0, fault);
      assert.ok(!fixture.events().includes("remove_deploy_store"), fault);
      assert.ok(!fixture.events().includes("remove_modules"), fault);
      assert.equal(
        readFileSync(join(fixture.directory, "foreign-data/sentinel"), "utf8"),
        "foreign-preserved",
      );
      if (fault === "deploy_store_owner")
        assert.ok(!fixture.events().includes("deploy"));
      for (const path of moduleRoots)
        assert.ok(existsSync(join(fixture.workspace, path)), fault);
    });
  await withFusedFixture(async (fixture) => {
    const result = await fixture.run({
      deploy: 43,
      fault: "deploy_store_stat_failure",
    });
    assert.equal(result.reason, "exit");
    assert.equal(result.code, 43, result.stderr);
    assert.ok(!fixture.events().includes("remove_deploy_store"));
    assert.ok(!fixture.events().includes("remove_modules"));
  });
});

/** Test-owned full payload vector; no image/native equivalence claim.
 * @param {string} directory
 * @returns {unknown[]}
 */
function payloadTree(directory) {
  /** @type {unknown[]} */ const result = [];
  /** @param {string} path @param {string} relative */
  function visit(path, relative) {
    const info = lstatSync(path),
      entry = {
        path: relative,
        mode: info.mode & 0o7777,
        uid: info.uid,
        gid: info.gid,
      };
    if (info.isSymbolicLink())
      result.push({ ...entry, type: "link", target: readlinkSync(path) });
    else if (info.isDirectory()) {
      result.push({ ...entry, type: "directory" });
      for (const name of readdirSync(path).sort())
        visit(join(path, name), join(relative, name));
    } else if (info.isFile())
      result.push({
        ...entry,
        type: "file",
        sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      });
    else assert.fail("nonregular private payload");
  }
  visit(directory, "");
  return result;
}
/** @param {string} directory */
function assertPortablePayload(directory) {
  const prefix = directory + "/";
  /** @param {string} path */
  function visit(path) {
    const info = lstatSync(path);
    if (info.isSymbolicLink()) {
      const target = resolve(dirname(path), readlinkSync(path));
      assert.ok(
        target.startsWith(prefix),
        "payload link escapes isolated deployment",
      );
      assert.ok(
        realpathSync(path).startsWith(prefix),
        "payload link resolves outside isolated deployment",
      );
    } else if (info.isDirectory())
      for (const name of readdirSync(path)) visit(join(path, name));
  }
  visit(directory);
}

// deterministic-test-allow unit-io: real private filesystem collisions are observed before the existing outside owner starts only relocated shell with command doubles; no pnpm/native infrastructure.
test("fresh production construction refuses every preexisting parent and dependency entry before install", async () => {
  for (const kind of [
    "directory",
    "file",
    "link",
    "dangling",
    ...moduleRoots.map((_, index) => "alias_" + index),
  ])
    await withFusedFixture(async (fixture) => {
      const target = join(fixture.workspace, ".production"),
        foreign = join(fixture.directory, "foreign-data");
      if (kind === "directory") {
        mkdirSync(target);
        writeFileSync(join(target, "sentinel"), "existing-parent");
      } else if (kind === "file") writeFileSync(target, "existing-parent");
      else
        symlinkSync(
          kind === "link"
            ? foreign
            : kind === "dangling"
              ? join(fixture.directory, "missing")
              : join(
                  fixture.workspace,
                  moduleRoots[Number(kind.slice(6))] ?? "invalid",
                ),
          target,
        );
      const before = lstatSync(target),
        link = before.isSymbolicLink() ? readlinkSync(target) : undefined;
      const result = await fixture.run();
      assert.equal(result.reason, "exit");
      assert.notEqual(result.code, 0);
      assert.ok(!fixture.events().includes("install"));
      assert.ok(!fixture.events().includes("remove_modules"));
      assert.equal(lstatSync(target).ino, before.ino);
      if (link !== undefined) assert.equal(readlinkSync(target), link);
      if (kind === "directory")
        assert.equal(
          readFileSync(join(target, "sentinel"), "utf8"),
          "existing-parent",
        );
      if (kind === "file")
        assert.equal(readFileSync(target, "utf8"), "existing-parent");
      assert.equal(
        readFileSync(join(foreign, "sentinel"), "utf8"),
        "foreign-preserved",
      );
    });
  for (const kind of ["file", "directory", "dangling"])
    for (const moduleRoot of moduleRoots)
      await withFusedFixture(async (fixture) => {
        const target = join(fixture.workspace, moduleRoot);
        if (kind === "file") writeFileSync(target, "foreign-module");
        else if (kind === "directory") {
          mkdirSync(target);
          writeFileSync(join(target, "sentinel"), "foreign-module");
        } else symlinkSync(join(fixture.directory, "missing"), target);
        const info = lstatSync(target),
          result = await fixture.run();
        assert.equal(result.reason, "exit");
        assert.notEqual(result.code, 0);
        assert.ok(!fixture.events().includes("install"));
        assert.equal(lstatSync(target).ino, info.ino);
      });
});

// deterministic-test-allow unit-io: fault adapters use real lstat identities and real replacements only under one fixture root; the outside owner reaps all synchronous child commands on every outcome.
test("all seven root and protected ancestry substitutions refuse before any dependency removal", async () => {
  const faults = [
    "id_failure",
    "id_malformed",
    "stat_missing",
    "stat_malformed",
    "stat_failed_after_output",
    "owner_mismatch",
    "owner_after_compile",
    "compile_parent_dir",
    "compile_parent_link",
    "compile_parent_alias_root",
    "deploy_parent_dir",
    "deploy_parent_link",
    "deploy_parent_alias_root",
    "replace_payload",
    "replace_payload_modules",
    "link_payload_modules",
    "alias_payload_root",
    "link_packages_parent",
    ...moduleRoots.flatMap((_, index) => [
      "replace_root_" + index,
      "link_root_" + index,
    ]),
  ];
  for (const fault of faults)
    await withFusedFixture(async (fixture) => {
      const result = await fixture.run({ fault });
      assert.equal(result.reason, "exit");
      assert.notEqual(result.code, 0, fault);
      if (fault === "id_failure") assert.equal(result.code, 43);
      if (fault === "stat_missing") assert.equal(result.code, 127);
      if (fault === "stat_failed_after_output") assert.equal(result.code, 47);
      assert.ok(!fixture.events().includes("remove_modules"), fault);
      assert.equal(
        readFileSync(join(fixture.directory, "foreign-data/sentinel"), "utf8"),
        "foreign-preserved",
      );
      if (fixture.events().includes("install"))
        for (const path of moduleRoots)
          assert.ok(
            existsSync(join(fixture.workspace, path)),
            fault + ":" + path,
          );
      if (fault.startsWith("replace_root_") || fault.startsWith("link_root_"))
        assert.ok(fixture.events().includes("deploy"), fault);
      if (fault.startsWith("compile_parent") || fault === "owner_after_compile")
        assert.ok(!fixture.events().includes("deploy"), fault);
      if (
        fault.startsWith("id_") ||
        fault.startsWith("stat_") ||
        fault === "owner_mismatch"
      )
        assert.ok(!fixture.events().includes("install"), fault);
      for (const name of readdirSync(fixture.directory).filter((value) =>
        value.startsWith("held-"),
      ))
        assert.ok(lstatSync(join(fixture.directory, name)).isDirectory());
    });
});

// deterministic-test-allow unit-io: real hardlinks/symlinks and byte/mode vectors are tested in a disposable filesystem; no actual package install/native payload assertion.
test("real removal preserves the complete owned payload vector and the independent closure oracle rejects an escaping link", async () => {
  for (const config of [
    {},
    { externalPayloadLink: true },
    { externalStoreLink: true },
  ])
    await withFusedFixture(async (fixture) => {
      const result = await fixture.run(config);
      assert.equal(result.reason, "exit");
      assert.equal(result.code, 0, result.stderr);
      const payload = join(fixture.workspace, ".production/backend");
      assert.deepEqual(
        payloadTree(payload),
        JSON.parse(
          readFileSync(join(fixture.directory, "payload-before.json"), "utf8"),
        ),
      );
      if (config.externalPayloadLink || config.externalStoreLink)
        assert.throws(
          () => assertPortablePayload(payload),
          /payload link escapes/u,
        );
      else assertPortablePayload(payload);
      // This negative proves the root guards do not constitute a full native dependency-link oracle.
      assert.equal(
        readFileSync(join(fixture.directory, "foreign-data/sentinel"), "utf8"),
        "foreign-preserved",
      );
    });
});

// deterministic-test-allow unit-io: unchanged real identity writer imports exact-pinned zod copied read-only to a private deployed tree; no install/package-manager or image build runs.
test("late identity recaptures stage-local roots and uses only the existing deployed dependency closure", async () => {
  const zod = realpathSync(join(root, "node_modules/zod"));
  assert.equal(
    z
      .object({ version: z.literal("4.6.5") })
      .parse(JSON.parse(readFileSync(join(zod, "package.json"), "utf8")))
      .version,
    "4.6.5",
  );
  for (const fault of [
    "success",
    "identity_parent_dir",
    "identity_parent_link",
    "identity_payload_link",
    "identity_modules_dir",
    "owner_mismatch",
    "stat_failed_after_output",
    "missing_zod",
    "invalid_release",
    "existing_identity",
    "root_collision",
  ])
    await withFusedFixture(async (fixture) => {
      const build = await fixture.run(
        fault === "missing_zod" ? {} : { zodSource: zod },
      );
      assert.equal(build.reason, "exit");
      assert.equal(build.code, 0, build.stderr);
      if (fault === "existing_identity")
        writeFileSync(
          join(fixture.workspace, "release-identity.json"),
          "foreign-identity",
        );
      if (fault === "root_collision")
        symlinkSync(
          join(fixture.directory, "missing"),
          join(fixture.workspace, "node_modules"),
        );
      const before = fixture.events().length;
      const result = await fixture.run(
        {
          fault,
          shiftStage: true,
          ...(fault === "invalid_release" ? { release: "invalid" } : {}),
        },
        true,
      );
      assert.equal(result.reason, "exit");
      const writer = fixture.events().slice(before).includes("identity_writer");
      if (fault === "success") {
        assert.equal(result.code, 0, result.stderr);
        assert.ok(writer);
        assert.deepEqual(
          JSON.parse(
            readFileSync(
              join(fixture.workspace, "release-identity.json"),
              "utf8",
            ),
          ),
          { release: "v123", sourceSha: "a".repeat(40) },
        );
        assert.equal(
          lstatSync(join(fixture.workspace, "release-identity.json")).mode &
            0o777,
          0o444,
        );
        assert.equal(
          readlinkSync(join(fixture.workspace, "node_modules")),
          ".production/backend/node_modules",
        );
      } else {
        assert.notEqual(result.code, 0, fault);
        assert.equal(
          writer,
          ["missing_zod", "invalid_release", "existing_identity"].includes(
            fault,
          ),
          fault,
        );
        if (fault === "existing_identity")
          assert.equal(
            readFileSync(
              join(fixture.workspace, "release-identity.json"),
              "utf8",
            ),
            "foreign-identity",
          );
        else
          assert.ok(
            !existsSync(join(fixture.workspace, "release-identity.json")),
          );
      }
      assert.equal(
        readFileSync(join(fixture.directory, "foreign-data/sentinel"), "utf8"),
        "foreign-preserved",
      );
    });
});

test("fused source cleanup refuses broader targets, early removal and protected-payload deletion", () => {
  const source = read("apps/backend/Dockerfile"),
    removal =
      "rm -rf -- " + moduleRoots.map((path) => "/workspace/" + path).join(" ");
  for (const addition of [
    "/workspace/.production/backend",
    "/workspace/apps/backend/dist",
    "/workspace/infra/tls",
    "/home/node",
    "/pnpm/store",
  ])
    assert.throws(() =>
      fusedInstruction(source.replace(removal, removal + " " + addition)),
    );
  assert.throws(() =>
    fusedInstruction(
      source.replace(
        removal,
        removal.replace(
          "/workspace/packages/legal/node_modules",
          "/workspace/packages/legal/*",
        ),
      ),
    ),
  );
  assert.throws(() =>
    fusedInstruction(
      source
        .replace(
          "pnpm --filter @inside/backend build:production",
          removal + "; pnpm --filter @inside/backend build:production",
        )
        .replace(removal + "; \\\n    check_output", "check_output"),
    ),
  );
});
