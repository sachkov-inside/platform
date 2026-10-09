// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
  realpathSync,
  copyFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

import {
  createMiniAppIdentityProofContext,
  readMiniAppIdentityProofContext,
  miniAppIdentityProofComposeArguments,
  assertMiniAppIdentityProofAvailable,
  prepareMiniAppIdentityProofContext,
} from "./mini-app-identity-proof.mjs";

test("isolated proof context never selects the primary identity directory or stand project", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "inside-461-proof-context-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = createMiniAppIdentityProofContext(root);
  mkdirSync(context.directory, { recursive: true });
  const path = join(context.directory, "context.json");
  writeFileSync(path, JSON.stringify(context));
  assert.deepEqual(readMiniAppIdentityProofContext(path, root), context);
  assert.equal(context.project, "inside-platform-461-codex-20261010-identity");
  assert.equal(context.directory, join(root, ".reports/461/runtime"));
  assert.equal(context.issuer, "https://identity.inside.localhost:14601/oidc");
  assert.equal(
    context.platformDatabaseUrl,
    "postgresql://inside461:inside461-synthetic@127.0.0.1:14603/inside461",
  );
  assert.equal(
    context.telegramDatabaseUrl,
    "postgresql://inside461:inside461-synthetic@127.0.0.1:14603/telegram461",
  );
  assert.deepEqual(miniAppIdentityProofComposeArguments(context), [
    "compose",
    "--project-name",
    "inside-platform-461-codex-20261010-identity",
    "--env-file",
    join(context.directory, "compose.env"),
    "-f",
    resolve(root, "infra/identity/logto/compose.461.yaml"),
  ]);
});

test("isolated proof rejects a shared path, forged project and linked data directory", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "inside-461-proof-reject-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = createMiniAppIdentityProofContext(root);
  const path = prepareMiniAppIdentityProofContext(context);
  assert.throws(
    () =>
      readMiniAppIdentityProofContext(
        join(root, ".identity-proof/context.json"),
        root,
      ),
    /must belong to this worktree/u,
  );
  writeFileSync(
    path,
    JSON.stringify({ ...context, project: "inside-platform" }),
  );
  assert.throws(
    () => readMiniAppIdentityProofContext(path, root),
    /isolated namespace/u,
  );
  rmSync(context.directory, { recursive: true });
  const primary = join(root, "primary-identity");
  mkdirSync(primary);
  symlinkSync(primary, context.directory);
  assert.throws(
    () => createMiniAppIdentityProofContext(root),
    /cannot use symbolic links/u,
  );
  rmSync(context.directory);
  symlinkSync(join(root, "missing-primary"), context.directory);
  assert.throws(
    () => createMiniAppIdentityProofContext(root),
    /cannot use symbolic links/u,
  );
});

test("readonly preflight refuses an occupied namespace before inspecting ports", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "inside-461-proof-preflight-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = createMiniAppIdentityProofContext(root);
  /** @type {{file: string, args: string[]}[]} */
  const commands = [];
  /** @type {import('./mini-app-identity-proof.mjs').ProofInventory} */
  const run = (file, args) => {
    commands.push({ file, args });
    return "synthetic-owned-container\n";
  };
  assert.throws(
    () => assertMiniAppIdentityProofAvailable(context, run),
    /namespace is occupied/u,
  );
  assert.deepEqual(commands, [
    {
      file: "docker",
      args: [
        "ps",
        "--all",
        "--filter",
        "label=com.docker.compose.project=inside-platform-461-codex-20261010-identity",
        "--format",
        "{{.ID}}",
      ],
    },
  ]);
});

test("readonly preflight refuses an occupied port and propagates an unavailable Docker inventory", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "inside-461-proof-ports-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = createMiniAppIdentityProofContext(root);
  /** @type {import('./mini-app-identity-proof.mjs').ProofInventory} */
  const occupied = (file, args) => {
    if (file === "docker") return "";
    assert.deepEqual(args, [
      "-a",
      "-nP",
      "-iTCP:14601",
      "-iTCP:14602",
      "-iTCP:14603",
      "-iTCP:14604",
      "-iTCP:14605",
      "-iTCP:14606",
      "-iTCP:14607",
      "-iTCP:14608",
      "-sTCP:LISTEN",
      "-Fp",
    ]);
    return "p46100\n";
  };
  assert.throws(
    () => assertMiniAppIdentityProofAvailable(context, occupied),
    /ports are occupied/u,
  );
  /** @type {import('./mini-app-identity-proof.mjs').ProofInventory} */
  const unavailable = () => {
    throw new Error("synthetic Docker unavailable");
  };
  assert.throws(
    () => assertMiniAppIdentityProofAvailable(context, unavailable),
    /Docker unavailable/u,
  );
  /** @type {import('./mini-app-identity-proof.mjs').ProofInventory} */
  const free = (file) => {
    if (file === "docker") return "";
    throw Object.assign(new Error("no listeners"), {
      status: 1,
      stdout: "",
      stderr: "",
    });
  };
  assert.doesNotThrow(() => assertMiniAppIdentityProofAvailable(context, free));
  /** @type {import('./mini-app-identity-proof.mjs').ProofInventory} */
  const unreadable = (file) => {
    if (file === "docker") return "";
    throw Object.assign(new Error("synthetic lsof denied"), {
      status: 1,
      stdout: "",
      stderr: "synthetic denied",
    });
  };
  assert.throws(
    () => assertMiniAppIdentityProofAvailable(context, unreadable),
    /lsof denied/u,
  );
});

test("readonly preflight preserves orphan proof volumes and networks instead of adopting them", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "inside-461-proof-orphans-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = createMiniAppIdentityProofContext(root);
  for (const resource of ["volume", "network"]) {
    /** @type {import('./mini-app-identity-proof.mjs').ProofInventory} */
    const run = (file, args) => {
      return file === "docker" && args?.[0] === resource
        ? `${context.project}_synthetic-orphan\n`
        : "";
    };
    assert.throws(
      () => assertMiniAppIdentityProofAvailable(context, run),
      /namespace is occupied/u,
    );
  }
});

test("bootstrap process adapter uses the isolated seed and issuer despite shared environment defaults", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "inside-461-bootstrap-adapter-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "infra/production/logto"), { recursive: true });
  mkdirSync(join(root, "bin"));
  for (const file of [
    "identity-proof-bootstrap.mjs",
    "identity-proof-environment.mjs",
    "identity-proof-access-token.mjs",
    "check-database.mjs",
    "mini-app-identity-proof.mjs",
  ])
    copyFileSync(resolve("scripts", file), join(root, "scripts", file));
  copyFileSync(
    resolve("infra/production/logto/learner-access.mjs"),
    join(root, "infra/production/logto/learner-access.mjs"),
  );
  symlinkSync(resolve("node_modules"), join(root, "node_modules"));
  const context = createMiniAppIdentityProofContext(root);
  const contextPath = prepareMiniAppIdentityProofContext(context);
  writeFileSync(
    join(root, "bin/docker"),
    `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';writeFileSync(process.env.PROOF_COMMAND_LOG,JSON.stringify(process.argv.slice(2)));console.log('synthetic-management-secret-461-only');\n`,
    { mode: 0o700 },
  );
  const commandLog = join(root, "docker-command.json");
  const code = `
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({url, method: options.method});
      return new Response(JSON.stringify(url.endsWith('/oidc/token') ? {access_token:'synthetic-management-token'} : {id:'synthetic-native-user'}));
    };
    const api = await import('./scripts/identity-proof-bootstrap.mjs');
    const secret = api.readSeededManagementSecret();
    const token = await api.fetchManagementAccessToken(secret);
    const user = await api.createManagementApi(token)('/users/synthetic-native-user');
    console.log(JSON.stringify({calls, user}));
  `;
  const result = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", code],
    {
      cwd: root,
      env: {
        PATH: `${join(root, "bin")}:${process.env["PATH"]}`,
        PROOF_COMMAND_LOG: commandLog,
        IDENTITY_PROOF_ISOLATED_CONTEXT: contextPath,
        IDENTITY_PROOF_LOGTO_PORT: "3301",
        IDENTITY_PROOF_LOGTO_ADMIN_PORT: "3302",
        DATABASE_URL: "postgresql://shared.invalid/inside",
      },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.deepEqual(JSON.parse(result), {
    calls: [
      {
        url: "https://identity.inside.localhost:14602/oidc/token",
        method: "POST",
      },
      {
        url: "https://identity.inside.localhost:14601/api/users/synthetic-native-user",
        method: "GET",
      },
    ],
    user: { id: "synthetic-native-user" },
  });
  assert.deepEqual(JSON.parse(readFileSync(commandLog, "utf8")), [
    ...miniAppIdentityProofComposeArguments(context),
    "exec",
    "-T",
    "logto-postgres",
    "psql",
    "-U",
    "logto",
    "-d",
    "logto",
    "-Atc",
    "select secret from applications where tenant_id='admin' and id='m-default'",
  ]);
  assert.throws(
    () =>
      execFileSync(process.execPath, ["--input-type=module", "-e", code], {
        cwd: root,
        env: {
          IDENTITY_PROOF_ISOLATED_CONTEXT: contextPath,
          LOGTO_ON_STAND: "true",
        },
        timeout: 10_000,
        stdio: "pipe",
      }),
    /cannot configure the shared stand/u,
  );
});
