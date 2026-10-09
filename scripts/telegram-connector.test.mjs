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
const scopeGuard = z.function({
  input: [z.unknown(), z.unknown().optional()],
  output: z.string().optional(),
});

test("a public OIDC transcript cannot transfer a launch without the original native browser secret", async () => {
  const module = await evaluateSource(async () => {
    throw new Error("No network in OIDC scope adapter");
  }, "../infra/identity/logto/fork/packages/core/src/libraries/inside-mini-app-binding.ts");
  /** @type {unknown} */
  const exported = Reflect.get(module.namespace, "miniAppConnectorScope");
  const scope = scopeGuard.parse(exported);
  const params = {
    client_id: "synthetic-platform-client",
    redirect_uri: "https://platform.test/callback",
    state: "synthetic-official-sdk-state",
    code_challenge: "A".repeat(43),
    code_challenge_method: "S256",
    response_type: "code",
    inside_mini_app_request: "46100000-0000-4000-8000-000000000001",
  };
  let rejected = false;
  try {
    scope(params);
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true);
});

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

test("Mini App connector binds the transferred OIDC attempt and uses the native social callback", async () => {
  const requestRef = "46100000-0000-4000-8000-000000000002";
  const oidcContextDigest = "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
  const launchBrowserSecret = "Z".repeat(43);
  /** @type {string[]} */
  const paths = [];
  const connector = await loadConnector(
    async (url, options) => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path.endsWith("/bind")) {
        const body = z
          .object({
            oidcContextDigest: z.string(),
            browserSecretDigest: z.string(),
            launchBrowserSecret: z.string(),
          })
          .parse(JSON.parse(String(options.body)));
        assert.equal(body.oidcContextDigest, oidcContextDigest);
        assert.equal(body.launchBrowserSecret, launchBrowserSecret);
        assert.match(body.browserSecretDigest, /^[A-Za-z0-9_-]{43}$/u);
        return Response.json({
          contractVersion: "inside.mini-app-sign-in.v1",
          status: "bound",
          expiresAt: "2026-10-10T10:05:00Z",
        });
      }
      return registered();
    },
    { ...config, miniAppEnabled: true },
  );
  let callback;
  const session = await authorize(
    connector,
    {
      scope: `inside.mini-app.v1:${JSON.stringify({ requestRef, oidcContextDigest, launchBrowserSecret })}`,
    },
    (url) => {
      callback = url;
    },
  );
  assert.equal(
    paths.includes(
      `/integrations/identity/v1/sign-in/mini-app/${requestRef}/bind`,
    ),
    true,
  );
  assert.equal(session.requestRef, requestRef);
  assert.equal(JSON.stringify(session).includes(launchBrowserSecret), false);
  assert.equal(String(callback).includes(launchBrowserSecret), false);
  assert.equal(new URL(String(callback)).pathname, "/callback");
  assert.equal(
    new URL(String(callback)).searchParams.get("inside_state"),
    session.state,
  );
});

test("a lost bind response retries with the same private browser and native interaction secret", async () => {
  const module = await evaluateSource(async () => {
    throw new Error("No network in OIDC scope adapter");
  }, "../infra/identity/logto/fork/packages/core/src/libraries/inside-mini-app-binding.ts");
  /** @type {unknown} */
  const exported = Reflect.get(module.namespace, "miniAppConnectorScope");
  const scope = scopeGuard.parse(exported);
  const params = {
    client_id: "synthetic-platform-client",
    redirect_uri: "https://platform.test/callback",
    state: "synthetic-official-sdk-state",
    code_challenge: "A".repeat(43),
    code_challenge_method: "S256",
    response_type: "code",
    inside_mini_app_request: "46100000-0000-4000-8000-000000000002",
  };
  const binding = {
    requestRef: params.inside_mini_app_request,
    oidcContextDigest: "fmyAW6qSXNj9bdJGt3speBvZttGXPWD9kywhl1fQVq4",
    launchBrowserSecret: "Z".repeat(43),
  };
  /** @type {string | undefined} */
  let boundDigest;
  let posts = 0;
  const connector = await loadConnector(
    async (_url, options) => {
      const body = z
        .object({ browserSecretDigest: z.string() })
        .parse(JSON.parse(String(options.body)));
      posts += 1;
      if (posts === 1) {
        boundDigest = body.browserSecretDigest;
        throw new TypeError("Synthetic response lost after binding commit");
      }
      return Response.json(
        body.browserSecretDigest === boundDigest
          ? {
              contractVersion: "inside.mini-app-sign-in.v1",
              status: "bound",
              expiresAt: "2026-10-10T10:05:00Z",
            }
          : {
              contractVersion: "inside.mini-app-sign-in.v1",
              status: "unavailable",
            },
      );
    },
    { ...config, miniAppEnabled: true },
  );
  /** @type {unknown} */
  let storage;
  const payload = {
    state: "synthetic-logto-social-state",
    redirectUri: "https://identity.test/callback",
    connectorId: "synthetic-connector",
    connectorFactoryId: "inside-telegram",
    jti: "synthetic-interaction",
  };
  await assert.rejects(
    connector.getAuthorizationUri(
      { ...payload, scope: String(scope(params, binding)) },
      async (value) => {
        storage = value;
      },
    ),
  );
  const callback = await connector
    .getAuthorizationUri(
      { ...payload, scope: String(scope(params, binding)) },
      async (value) => {
        storage = value;
      },
    )
    .catch(() => undefined);
  assert.equal(
    callback === undefined
      ? undefined
      : new URL(callback).searchParams.get("code"),
    params.inside_mini_app_request,
  );
  assert.equal(posts, 2);
  assert.equal(sessionGuard.safeParse(storage).success, true);
  await assert.rejects(
    connector.getAuthorizationUri(
      {
        ...payload,
        jti: "another-native-interaction",
        scope: String(scope(params, binding)),
      },
      async () => {},
    ),
  );
});

test("Logto derives the launch binding from original OIDC state and PKCE, using the portable vector", async () => {
  const fixture = z
    .object({
      oidcContext: z.object({
        parameters: z.object({
          clientId: z.string(),
          redirectUri: z.string(),
          state: z.string(),
          codeChallenge: z.string(),
        }),
        digest: z.string(),
      }),
    })
    .parse(
      JSON.parse(
        await readFile(
          new URL(
            "../docs/contracts/mini-app-sign-in-v1/fixtures.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
  const module = await evaluateSource(async () => {
    throw new Error("No network in OIDC scope adapter");
  }, "../infra/identity/logto/fork/packages/core/src/libraries/inside-mini-app-binding.ts");
  /** @type {unknown} */
  const exported = Reflect.get(module.namespace, "miniAppConnectorScope");
  const scope = scopeGuard.parse(exported);
  const { parameters, digest } = fixture.oidcContext;
  const requestRef = "46100000-0000-4000-8000-000000000001";
  assert.equal(
    scope(
      {
        client_id: parameters.clientId,
        redirect_uri: parameters.redirectUri,
        state: parameters.state,
        code_challenge: parameters.codeChallenge,
        code_challenge_method: "S256",
        response_type: "code",
        inside_mini_app_request: requestRef,
      },
      {
        requestRef,
        oidcContextDigest: digest,
        launchBrowserSecret: "Z".repeat(43),
      },
    ),
    `inside.mini-app.v1:${JSON.stringify({ requestRef, oidcContextDigest: digest, launchBrowserSecret: "Z".repeat(43) })}`,
  );
});

test("Mini App mode stays off unless the connector explicitly enables it", async () => {
  let posts = 0;
  const connector = await loadConnector(async () => {
    posts += 1;
    return registered();
  });
  await assert.rejects(
    authorize(connector, {
      scope: `inside.mini-app.v1:${JSON.stringify({ requestRef: "46100000-0000-4000-8000-000000000001", oidcContextDigest: "X".repeat(43) })}`,
    }),
  );
  assert.equal(posts, 0);
});

for (const mismatch of ["state", "request"]) {
  test(`a different social callback ${mismatch} cannot consume or read a receipt`, async () => {
    let consumes = 0;
    const connector = await loadConnector(async (url) => {
      if (!new URL(url).pathname.endsWith("/sign-in")) consumes += 1;
      return registered();
    });
    const session = await authorize(connector);
    await assert.rejects(
      connector.getUserInfo(
        {
          inside_state:
            mismatch === "state" ? "another-social-state" : session.state,
          code:
            mismatch === "request"
              ? "46100000-0000-4000-8000-000000000009"
              : session.requestRef,
        },
        async () => session,
      ),
    );
    assert.equal(consumes, 0);
  });
}

test("a launch reference requires a complete S256 code request and never uses a social payload as OIDC context", async () => {
  const module = await evaluateSource(async () => {
    throw new Error("No network in OIDC scope adapter");
  }, "../infra/identity/logto/fork/packages/core/src/libraries/inside-mini-app-binding.ts");
  /** @type {unknown} */
  const exported = Reflect.get(module.namespace, "miniAppConnectorScope");
  const scope = scopeGuard.parse(exported);
  assert.equal(
    scope({ scope: "inside.mini-app.v1:client-selected" }),
    undefined,
  );
  const params = {
    client_id: "synthetic-platform-client",
    redirect_uri: "https://platform.test/callback",
    state: "synthetic-official-sdk-state",
    code_challenge: "A".repeat(43),
    code_challenge_method: "S256",
    response_type: "code",
    inside_mini_app_request: "46100000-0000-4000-8000-000000000001",
  };
  const binding = {
    requestRef: params.inside_mini_app_request,
    oidcContextDigest: "fmyAW6qSXNj9bdJGt3speBvZttGXPWD9kywhl1fQVq4",
    launchBrowserSecret: "Z".repeat(43),
  };
  for (const field of [
    "client_id",
    "redirect_uri",
    "state",
    "code_challenge",
  ]) {
    const changed = {
      ...params,
      [field]:
        field === "redirect_uri"
          ? "https://other.test/callback"
          : "B".repeat(43),
    };
    assert.throws(() => scope(changed, binding));
  }
  assert.throws(() =>
    scope({ ...params, insideMiniAppBrowserBinding: binding }),
  );
  assert.throws(() =>
    scope(params, {
      ...binding,
      requestRef: "46100000-0000-4000-8000-000000000009",
    }),
  );
  assert.throws(() => scope({ ...params, code_challenge_method: "plain" }));
  assert.throws(() => scope({ ...params, response_type: "token" }));
  assert.throws(() =>
    scope({ inside_mini_app_request: params.inside_mini_app_request }),
  );
});

/**
 * Adapter contract: actual connector source, synthetic Kit enums/error and supplied HTTP double.
 * This does not exercise pinned Logto, cookies, native interactions or persistent transactions.
 * @param {(url: string, options: RequestInit) => Promise<Response>} post
 * @param {unknown} [connectorConfig]
 */
async function loadConnector(post, connectorConfig = config) {
  const module = await evaluateSource(
    post,
    "../infra/identity/logto/connector-inside-telegram/index.ts",
  );
  /** @type {unknown} */
  const exported = Reflect.get(module.namespace, "default");
  const factory = factoryGuard.parse(exported);
  return connectorGuard.parse(
    await factory({ getConfig: async () => connectorConfig }),
  );
}

/**
 * @param {(url: string, options: RequestInit) => Promise<Response>} post
 * @param {string} path
 */
async function evaluateSource(post, path) {
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
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const module = new SourceTextModule(stripTypeScriptTypes(source), {
    context,
  });
  await module.link((specifier) => {
    const dependency = dependencies.get(specifier);
    assert.ok(dependency, `Unexpected connector dependency: ${specifier}`);
    return dependency;
  });
  await module.evaluate();
  return module;
}

/**
 * @param {z.infer<typeof connectorGuard>} connector
 * @param {Record<string, string>} [extra]
 * @param {(url: string) => void} [navigate]
 */
async function authorize(connector, extra = {}, navigate = () => {}) {
  /** @type {unknown} */
  let session;
  const url = await connector.getAuthorizationUri(
    {
      state: "synthetic-logto-social-state",
      redirectUri: "https://identity.test/callback",
      connectorId: "synthetic-connector",
      connectorFactoryId: "inside-telegram",
      jti: "synthetic-interaction",
      ...extra,
    },
    async (/** @type {unknown} */ value) => {
      session = value;
    },
  );
  navigate(url);
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
