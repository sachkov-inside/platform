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

const root = new URL("../", import.meta.url);
const proofRoot = new URL("infra/identity/logto/", root);

test("identity proof dependencies and fork lineage are immutable", async () => {
  const [versionsSource, dockerfile, compose, packageSource] = await Promise.all([
    readFile(new URL("versions.json", proofRoot), "utf8"),
    readFile(new URL("Dockerfile", proofRoot), "utf8"),
    readFile(new URL("compose.yaml", proofRoot), "utf8"),
    readFile(new URL("apps/web/package.json", root), "utf8"),
  ]);
  const versions = JSON.parse(versionsSource);
  const webPackage = JSON.parse(packageSource);

  assert.equal(versions.logto.version, "1.41.0");
  assert.match(versions.logto.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(versions.logto.upstreamRevision.length, 40);
  assert.match(dockerfile, new RegExp(versions.logto.digest, "u"));
  assert.match(dockerfile, new RegExp(versions.logto.upstreamRevision, "u"));
  assert.match(compose, new RegExp(versions.postgres.digest, "u"));
  assert.match(compose, new RegExp(versions.mailpit.digest, "u"));
  assert.equal(webPackage.dependencies["@logto/next"], versions.logtoNext);
  assert.doesNotMatch(`${dockerfile}\n${compose}`, /(?:latest|npx\s)/u);
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

test("custom access-token claims require a matching fresh email-code interaction", async () => {
  const source = await readFile(new URL("custom-access-token.js", proofRoot), "utf8");
  const getCustomJwtClaims = Function(
    `"use strict"; ${source}; return getCustomJwtClaims;`,
  )();
  const denied = Symbol("denied");
  const api = { denyAccess: () => denied };
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
    api,
  });
  assert.equal(claims.inside_verified_email, "member@example.test");
  assert.ok(Number.isFinite(Date.parse(claims.inside_interactive_at)));
  assert.deepEqual(
    await getCustomJwtClaims({ token: { gty: "refresh_token" }, context: {}, api }),
    {},
  );
  assert.equal(
    await getCustomJwtClaims({
      token: { gty: "authorization_code" },
      context: {
        ...verifiedContext,
        user: { primaryEmail: "another@example.test" },
      },
      api,
    }),
    denied,
  );
});

test("identity proof bootstrap replaces the manual wizard and isolates generated configuration", async () => {
  const [packageSource, bootstrap, readme] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("identity-proof-bootstrap.mjs", import.meta.url), "utf8"),
    readFile(new URL("README.md", proofRoot), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.scripts["identity:proof:setup"], undefined);
  assert.match(packageJson.scripts["identity:proof:up"], /identity:proof:bootstrap/u);
  assert.match(packageJson.scripts["identity:proof:start"], /identity-proof-start/u);
  assert.match(bootstrap, /id='m-default'/u);
  assert.match(bootstrap, /\/configs\/jwt-customizer\/access-token/u);
  assert.match(bootstrap, /\.identity-proof\/platform\.env/u);
  assert.doesNotMatch(readme, /wizard|identity:proof:setup/u);

  assert.equal(
    mergeEnv("KEEP=unchanged\nLOGTO_APP_ID=old\n", {
      LOGTO_APP_ID: "new",
      LOGTO_APP_SECRET: "generated",
    }),
    "KEEP=unchanged\nLOGTO_APP_ID=new\nLOGTO_APP_SECRET=generated\n",
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
    "http://127.0.0.1:3000/reauthentication-callback",
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
