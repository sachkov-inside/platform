import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  ensureApplication,
  ensureEmailConnector,
  ensureResource,
  ensureSignInExperience,
  mergeEnv,
} from "./identity-proof-bootstrap.mjs";
import {
  isolateIdentityProofEnvironment,
  readIdentityProofEndpoints,
  readIdentityProofPort,
} from "./identity-proof-environment.mjs";
import { runIdentityProofSession } from "./identity-proof-session.mjs";

const root = new URL("../", import.meta.url);
const proofRoot = new URL("infra/identity/logto/", root);

test("identity proof dependencies and fork lineage are immutable", async () => {
  const [versionsSource, dockerfile, compose, packageSource, hardeningPatch] = await Promise.all([
    readFile(new URL("versions.json", proofRoot), "utf8"),
    readFile(new URL("Dockerfile", proofRoot), "utf8"),
    readFile(new URL("compose.yaml", proofRoot), "utf8"),
    readFile(new URL("apps/web/package.json", root), "utf8"),
    readFile(new URL("patches/issue-116-logto-proof.patch", proofRoot), "utf8"),
  ]);
  const versions = JSON.parse(versionsSource);
  const webPackage = JSON.parse(packageSource);

  assert.equal(versions.logto.version, "1.41.0");
  assert.match(versions.logto.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(versions.logto.upstreamRevision.length, 40);
  assert.equal(versions.logto.forkRevision, "inside.2");
  assert.match(dockerfile, new RegExp(versions.logto.digest, "u"));
  assert.match(dockerfile, new RegExp(versions.logto.upstreamRevision, "u"));
  assert.match(dockerfile, new RegExp(versions.logto.forkRevision, "u"));
  assert.match(compose, new RegExp(versions.logto.forkRevision, "u"));
  assert.match(compose, new RegExp(versions.postgres.digest, "u"));
  assert.match(compose, new RegExp(versions.mailpit.digest, "u"));
  assert.equal(webPackage.dependencies["@logto/next"], versions.logtoNext);
  assert.doesNotMatch(`${dockerfile}\n${compose}`, /(?:latest|npx\s)/u);
  assert.match(dockerfile, /issue-116-logto-proof\.patch/u);
  assert.match(dockerfile, /patch --fuzz=0/u);
  assert.match(dockerfile, /connectors\/connector-smtp[\s\S]+npm run build/u);
  assert.match(dockerfile, /grep -q "instanceof Error" lib\/index\.js/u);
  assert.match(dockerfile, /jest --runInBand build\/sentinel\/message-rate-guard\.test\.js/u);
  assert.match(hardeningPatch, /pg_advisory_xact_lock/u);
  assert.match(hardeningPatch, /keeps the reservation when provider acknowledgement is ambiguous/u);
  assert.doesNotMatch(hardeningPatch, /deleteActivity|guard\.release|Partial</u);
  assert.match(hardeningPatch, /recipient: '\[redacted\]'/u);
  assert.match(hardeningPatch, /message_rate_limited: 'Слишком много писем\./u);
  assert.doesNotMatch(hardeningPatch, /inside_session|inside_signin|captcha/iu);
});

test("Experience UI fork keeps the Inside shell and removes the unknown-account prompt", async () => {
  const [layout, title, verification] = await Promise.all([
    readFile(
      new URL(
        "fork/packages/experience/src/Layout/AppLayout/index.tsx",
        proofRoot,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "fork/packages/experience/src/utils/sign-in-experience.ts",
        proofRoot,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "fork/packages/experience/src/containers/VerificationCode/use-sign-in-flow-code-verification.ts",
        proofRoot,
      ),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(layout, /LogtoSignature|Powered by/u);
  assert.match(title, /return 'Sachkov Inside'/u);
  assert.doesNotMatch(verification, /usePromiseConfirmModal|sign_in_id_does_not_exist/u);
  assert.match(verification, /registerWithIdentifierAsync\(verificationId\)/u);
});

test("Management API bootstrap forces the Platform light Russian experience", async () => {
  let request;
  await ensureSignInExperience(async (path, options) => {
    request = { path, ...options };
    return {};
  });

  assert.equal(request.path, "/sign-in-exp");
  assert.equal(request.method, "PATCH");
  assert.equal(request.body.color.primaryColor, "#EE5D27");
  assert.equal(request.body.color.isDarkModeEnabled, false);
  assert.deepEqual(request.body.languageInfo, {
    autoDetect: false,
    fallbackLanguage: "ru",
  });
});

test("custom access-token claims expose only a matching fresh email-code interaction", async () => {
  const source = await readFile(new URL("custom-access-token.js", proofRoot), "utf8");
  const getCustomJwtClaims = Function(
    `"use strict"; ${source}; return getCustomJwtClaims;`,
  )();
  const verifiedContext = {
    user: { primaryEmail: "Member@Example.Test" },
    interaction: {
      verificationRecords: [
        {
          type: "EmailVerificationCode",
          verified: true,
          identifier: { type: "email", value: "member@example.test" },
        },
      ],
    },
  };

  const claims = await getCustomJwtClaims({
    token: { gty: "authorization_code" },
    context: verifiedContext,
  });
  assert.equal(claims.inside_verified_email, "member@example.test");
  assert.equal("inside_interactive_at" in claims, false);
  assert.deepEqual(
    await getCustomJwtClaims({ token: { gty: "refresh_token" }, context: {} }),
    {},
  );
  assert.deepEqual(
    await getCustomJwtClaims({
      token: { gty: "authorization_code" },
      context: {
        ...verifiedContext,
        user: { primaryEmail: "another@example.test" },
      },
    }),
    {},
  );
});

test("identity proof bootstrap replaces the manual wizard and isolates generated configuration", async () => {
  const [packageSource, bootstrap, hardening, nextConfig, readme] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("identity-proof-bootstrap.mjs", import.meta.url), "utf8"),
    readFile(new URL("identity-hardening-proof.mjs", import.meta.url), "utf8"),
    readFile(new URL("apps/web/next.config.ts", root), "utf8"),
    readFile(new URL("README.md", proofRoot), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.scripts["identity:proof:setup"], undefined);
  assert.match(packageJson.scripts["identity:proof:up"], /identity:proof:bootstrap/u);
  assert.match(packageJson.scripts["identity:proof:start"], /identity-proof-start/u);
  assert.match(packageJson.scripts["identity:proof:hardening"], /identity-hardening-proof/u);
  assert.match(bootstrap, /id='m-default'/u);
  assert.match(bootstrap, /\/configs\/jwt-customizer\/access-token/u);
  assert.match(bootstrap, /\.identity-proof\/platform\.env/u);
  assert.match(hardening, /inside-identity-proof-116/u);
  assert.match(hardening, /inside-platform-proof-116/u);
  assert.match(
    hardening,
    /\["up", "-d", "--wait", "postgres", "object-storage"\]/u,
  );
  assert.match(hardening, /to_regclass\('identity_principals\.platform_sessions'\)/u);
  assert.match(hardening, /logs where/u);
  assert.match(nextConfig, /incomingRequests:[\s\S]+ignore:[\s\S]+callback/u);
  assert.doesNotMatch(readme, /wizard|identity:proof:setup/u);

  assert.equal(
    mergeEnv("KEEP=unchanged\nLOGTO_APP_ID=old\n", {
      LOGTO_APP_ID: "new",
      LOGTO_APP_SECRET: "generated",
    }),
    "KEEP=unchanged\nLOGTO_APP_ID=new\nLOGTO_APP_SECRET=generated\n",
  );
});

test("identity proof launcher isolates root env, applies ports, and cleans owned stacks", async () => {
  const [start, development, packageSource] = await Promise.all([
    readFile(new URL("identity-proof-start.mjs", import.meta.url), "utf8"),
    readFile(new URL("identity-proof-dev.mjs", import.meta.url), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const environment = isolateIdentityProofEnvironment(
    {
      IDENTITY_PROOF_API_PORT: "3501",
      IDENTITY_PROOF_POSTGRES_PORT: "55432",
      IDENTITY_PROOF_WEB_PORT: "3500",
      PATH: "/usr/bin",
    },
    [
      [
        "DATABASE_URL=postgresql://wrong-root-env",
        "OBJECT_STORAGE_ENDPOINT=http://wrong-root-env:9000",
        "WEB_BASE_URL=http://wrong-root-env:3000",
      ].join("\n"),
    ],
  );
  const calls = [];
  const runCompose = async (project, arguments_, commandEnvironment, capture) => {
    calls.push({
      arguments: arguments_,
      capture,
      environment: { ...commandEnvironment },
      project,
      type: "compose",
    });
    return "";
  };
  const runPnpm = async (arguments_, commandEnvironment) => {
    calls.push({
      arguments: arguments_,
      environment: { ...commandEnvironment },
      type: "pnpm",
    });
  };

  await runIdentityProofSession({
    environment,
    readGeneratedEnvironment: async () => ({
      BACKEND_BASE_URL: "http://127.0.0.1:3501",
      DATABASE_URL: "postgresql://inside:inside@127.0.0.1:55432/inside",
      WEB_BASE_URL: "http://127.0.0.1:3500",
    }),
    runCompose,
    runPnpm,
  });

  const migration = calls.find(
    (call) => call.type === "pnpm" && call.arguments.includes("db:migrate"),
  );
  assert.equal(
    migration.environment.DATABASE_URL,
    "postgresql://inside:inside@127.0.0.1:55432/inside",
  );
  assert.equal(migration.environment.OBJECT_STORAGE_ENDPOINT, "");
  assert.equal(migration.environment.WEB_BASE_URL, "http://127.0.0.1:3500");
  const platformUp = calls.find(
    (call) =>
      call.type === "compose" &&
      call.project === "platform" &&
      call.arguments[0] === "up",
  );
  const identityUp = calls.find(
    (call) =>
      call.type === "compose" &&
      call.project === "identity" &&
      call.arguments[0] === "up",
  );
  assert.equal(identityUp.environment.COMPOSE_PROJECT_NAME, "inside-identity-proof");
  assert.equal(platformUp.environment.COMPOSE_PROJECT_NAME, "inside-platform");
  assert.equal(platformUp.environment.POSTGRES_HOST_PORT, "55432");
  assert.deepEqual(
    calls.slice(-2).map(({ arguments: arguments_, project }) => [
      project,
      arguments_,
    ]),
    [
      ["platform", ["down"]],
      ["identity", ["down"]],
    ],
  );
  assert.deepEqual(readIdentityProofEndpoints(environment), {
    apiPort: 3501,
    backendBaseUrl: "http://127.0.0.1:3501",
    webBaseUrl: "http://127.0.0.1:3500",
    webPort: 3500,
  });
  const rootOnlyProofOverrides = isolateIdentityProofEnvironment({}, [
    [
      "IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS=60",
      "IDENTITY_PROOF_API_PORT=3998",
      "IDENTITY_PROOF_POSTGRES_PORT=55439",
      "IDENTITY_PROOF_WEB_PORT=3999",
    ].join("\n"),
  ]);
  assert.deepEqual(readIdentityProofEndpoints(rootOnlyProofOverrides), {
    apiPort: 3001,
    backendBaseUrl: "http://127.0.0.1:3001",
    webBaseUrl: "http://127.0.0.1:3000",
    webPort: 3000,
  });
  assert.equal(rootOnlyProofOverrides.IDENTITY_PROOF_POSTGRES_PORT, undefined);
  assert.equal(
    rootOnlyProofOverrides.IDENTITY_PROOF_ACCESS_TOKEN_TTL_SECONDS,
    undefined,
  );
  assert.doesNotMatch(development, /loadEnvFile|resolve\(root, "\.env"\)/u);
  assert.match(start, /infra\/identity\/logto\/compose\.env/u);
  assert.match(
    packageJson.scripts["identity:proof:up"],
    /--env-file infra\/identity\/logto\/compose\.env/u,
  );
  assert.equal(readIdentityProofPort({}, "IDENTITY_PROOF_API_PORT", 3001), 3001);
  assert.equal(
    readIdentityProofPort(
      { IDENTITY_PROOF_API_PORT: "3501" },
      "IDENTITY_PROOF_API_PORT",
      3001,
    ),
    3501,
  );
  assert.throws(
    () => readIdentityProofPort(
      { IDENTITY_PROOF_API_PORT: "0" },
      "IDENTITY_PROOF_API_PORT",
      3001,
    ),
    /IDENTITY_PROOF_API_PORT must be a valid TCP port/u,
  );
});

test("identity proof launcher rejects any running Platform service", async () => {
  const composeCalls = [];
  await assert.rejects(
    runIdentityProofSession({
      environment: {},
      readGeneratedEnvironment: async () => ({}),
      runCompose: async (project, arguments_) => {
        composeCalls.push([project, arguments_]);
        return project === "platform" ? "object-storage\n" : "";
      },
      runPnpm: async () => undefined,
    }),
    /Platform Compose stack is already running/u,
  );
  assert.deepEqual(composeCalls, [
    ["platform", ["ps", "--services", "--status", "running"]],
  ]);
});

test("identity proof launcher cleans both owned stacks after development stops", async () => {
  const calls = [];
  await assert.rejects(
    runIdentityProofSession({
      environment: {},
      readGeneratedEnvironment: async () => ({}),
      runCompose: async (project, arguments_) => {
        calls.push(["compose", project, arguments_]);
        return "";
      },
      runPnpm: async (arguments_) => {
        calls.push(["pnpm", arguments_]);
        if (arguments_[0] === "identity:proof:dev") {
          throw new Error("development process terminated");
        }
      },
    }),
    /development process terminated/u,
  );
  assert.deepEqual(calls.slice(-2), [
    ["compose", "platform", ["down"]],
    ["compose", "identity", ["down"]],
  ]);
});

test("identity proof launcher stops startup and cleans ownership after interruption", async () => {
  const calls = [];
  let interrupted = false;
  await assert.rejects(
    runIdentityProofSession({
      environment: {},
      readGeneratedEnvironment: async () => ({}),
      runCompose: async (project, arguments_) => {
        calls.push(["compose", project, arguments_]);
        if (project === "identity" && arguments_[0] === "up") {
          interrupted = true;
        }
        return "";
      },
      runPnpm: async (arguments_) => {
        calls.push(["pnpm", arguments_]);
      },
      shouldStop: () => interrupted,
    }),
    /startup was interrupted/u,
  );
  assert.equal(
    calls.some(
      (call) => call[0] === "pnpm" && call[1][0] === "identity:proof:bootstrap",
    ),
    false,
  );
  assert.deepEqual(calls.at(-1), ["compose", "identity", ["down"]]);
});

test("identity hardening proof uses an exact semantic logout assertion", async () => {
  const hardeningSpec = await readFile(
    new URL("apps/web/test/identity/identity-proof.spec.ts", root),
    "utf8",
  );

  assert.doesNotMatch(hardeningSpec, /locator\([^\n]+hasText: "Выйти"/u);
  assert.match(
    hardeningSpec,
    /getByRole\("button", \{ exact: true, name: "Выйти" \}\)/u,
  );
});

test("Management API bootstrap converges after partial state and a repeated run", async () => {
  const state = {
    resources: [
      {
        id: "resource-existing",
        indicator: "http://127.0.0.1:3001",
        name: "stale",
        accessTokenTtl: 30,
      },
    ],
    applications: [],
    connectors: [],
  };
  const api = managementApiFake(state);

  for (let run = 0; run < 2; run += 1) {
    await ensureResource(api);
    await ensureApplication(api);
    await ensureEmailConnector(api);
  }

  assert.equal(state.resources.length, 1);
  assert.equal(state.resources[0].name, "Inside Platform API");
  assert.equal(state.resources[0].accessTokenTtl, 300);
  assert.equal(state.applications.length, 1);
  assert.equal(state.applications[0].name, "Inside Web");
  assert.deepEqual(state.applications[0].oidcClientMetadata.redirectUris, [
    "http://127.0.0.1:3000/callback",
  ]);
  assert.equal(state.connectors.length, 1);
  assert.equal(state.connectors[0].connectorId, "simple-mail-transfer-protocol");
});

test("Management API bootstrap rejects malformed resource and application payloads", async () => {
  await assert.rejects(
    ensureResource(async () => [
      { indicator: "http://127.0.0.1:3001", name: "missing id" },
    ]),
    /Logto resources response is invalid/u,
  );
  await assert.rejects(
    ensureApplication(async () => [{ id: "application-without-name" }]),
    /Logto applications response is invalid/u,
  );
});

function managementApiFake(state) {
  return async (path, { method = "GET", body } = {}) => {
    const collection = path === "/resources"
      ? state.resources
      : path === "/applications"
        ? state.applications
        : path === "/connectors"
          ? state.connectors
          : undefined;
    if (method === "GET" && collection !== undefined) {
      return collection.map((entry) => ({ ...entry }));
    }
    if (method === "POST" && collection !== undefined) {
      const created = { id: `${path.slice(1)}-${String(collection.length + 1)}`, ...body };
      collection.push(created);
      return { ...created };
    }
    if (method === "PATCH") {
      const [name, id] = path.slice(1).split("/");
      const target = state[name]?.find((entry) => entry.id === id);
      assert.ok(target, `Missing fake Management API target ${path}`);
      Object.assign(target, body);
      return { ...target };
    }
    throw new Error(`Unhandled fake Management API call: ${method} ${path}`);
  };
}
