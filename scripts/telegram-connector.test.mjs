// @ts-check
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import { z } from "zod";

const instant = Date.parse("2026-10-10T10:00:00Z");
const subjectRef = "46100000-0000-4000-8000-000000000001";
const getConfigGuard = z.function({
  input: [z.string()],
  output: z.promise(z.unknown()),
});
const factoryGuard = z.function({
  input: [z.object({ getConfig: getConfigGuard })],
  output: z.promise(z.unknown()),
});
const authorizationGuard = z.function({
  input: [
    z.record(z.string(), z.string()),
    z.function({ input: [z.unknown()], output: z.promise(z.void()) }),
  ],
  output: z.promise(z.string()),
});
const userInfoGuard = z.function({
  input: [
    z.unknown(),
    z.function({ input: [], output: z.promise(z.unknown()) }),
  ],
  output: z.promise(z.unknown()),
});
const connectorGuard = z.object({
  getAuthorizationUri: authorizationGuard,
  getUserInfo: userInfoGuard,
});
const sessionGuard = z
  .object({ requestRef: z.uuid(), state: z.string() })
  .passthrough();
const config = {
  enabled: true,
  platformUrl: "https://platform.test",
  issuer: "https://identity.test/oidc",
  providerUrl: "https://telegram.test",
  integrationSecret: "461-synthetic-integration-secret-not-a-credential",
  botUsername: "synthetic_bot",
};

test("connector recovers the same subject after consume committed but its response was lost", async () => {
  /** @type {string[]} */
  const operations = [];
  let consumed = false;
  const connector = await loadConnector(async (url) => {
    const path = new URL(url).pathname;
    operations.push(path);
    if (path.endsWith("/consume")) {
      consumed = true;
      throw new TypeError("Synthetic lost response after commit");
    }
    if (path.endsWith("/receipt")) {
      assert.equal(consumed, true);
      return Response.json({
        contractVersion: "inside.bot-sign-in.v1",
        status: "verified",
        subjectRef,
        approvedAt: "2026-10-10T10:00:00Z",
        existingLink: null,
      });
    }
    return registered();
  });
  const session = await authorize(connector);
  const recovered = await connector
    .getUserInfo(
      { inside_state: session.state, code: session.requestRef },
      async () => session,
    )
    .catch(() => undefined);
  const result = z.object({ id: z.string() }).safeParse(recovered);
  assert.equal(result.success ? result.data.id : undefined, subjectRef);
  assert.equal(
    operations.filter((path) => path.endsWith("/consume")).length,
    1,
  );
  assert.equal(
    operations.filter((path) => path.endsWith("/receipt")).length,
    1,
  );
});

/**
 * Adapter contract: actual connector source, synthetic Kit enums/error and supplied HTTP double.
 * This does not exercise pinned Logto, cookies, native interactions or persistent transactions.
 * @param {(url: string, options: RequestInit) => Promise<Response>} post
 */
async function loadConnector(post) {
  const context = createContext({
    fetch: post,
    AbortSignal,
    URL,
    Date: class {
      static now() {
        return instant;
      }
      /** @param {string} value */
      static parse(value) {
        return Date.parse(value);
      }
      /** @param {number} value */
      constructor(value) {
        return new Date(value);
      }
    },
  });
  class ConnectorError extends Error {}
  const kit = {
    ConnectorError,
    ConnectorErrorCodes: { AuthorizationFailed: "AuthorizationFailed" },
    ConnectorPlatform: { Universal: "Universal" },
    ConnectorType: { Social: "Social" },
  };
  /** @param {Record<string, unknown>} values */
  const external = (values) =>
    new SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values))
          this.setExport(key, value);
      },
      { context },
    );
  const dependencies = new Map([
    ["node:crypto", external(crypto)],
    ["@logto/connector-kit", external(kit)],
    ["zod", external({ z })],
  ]);
  const source = await readFile(
    new URL(
      "../infra/identity/logto/connector-inside-telegram/index.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const module = new SourceTextModule(stripTypeScriptTypes(source), {
    context,
  });
  await module.link((specifier) => {
    const dependency = dependencies.get(specifier);
    assert.ok(dependency, `Unexpected connector dependency: ${specifier}`);
    return dependency;
  });
  await module.evaluate();
  /** @type {unknown} */
  const exported = Reflect.get(module.namespace, "default");
  const factory = factoryGuard.parse(exported);
  return connectorGuard.parse(await factory({ getConfig: async () => config }));
}

/** @param {z.infer<typeof connectorGuard>} connector */
async function authorize(connector) {
  /** @type {unknown} */
  let session;
  await connector.getAuthorizationUri(
    {
      state: "synthetic-logto-social-state",
      redirectUri: "https://identity.test/callback",
      connectorId: "synthetic-connector",
      connectorFactoryId: "inside-telegram",
      jti: "synthetic-interaction",
    },
    async (/** @type {unknown} */ value) => {
      session = value;
    },
  );
  return sessionGuard.parse(session);
}

function registered() {
  return Response.json({
    contractVersion: "inside.bot-sign-in.v1",
    status: "registered",
    confirmationCode: "123456",
    expiresAt: "2026-10-10T10:05:00Z",
  });
}
