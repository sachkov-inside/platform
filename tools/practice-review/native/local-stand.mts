import { createMcpHttpServer } from "../../../apps/backend/src/entrypoints/mcp/mcp-http-server.js";
import { createLogtoAccessTokenVerifier } from "../../../apps/backend/src/modules/accounts/infrastructure/idp/logto/logto-access-token-verifier.js";
import { refusingMcpToolDependencies } from "../../../apps/backend/test/fixtures/inside-mcp-dependencies.js";
import type { LearnerMcpDependencies } from "../../../apps/backend/src/modules/content-library/index.js";
import { startSyntheticAuthorizationServer } from "./oauth-server.mjs";

/** Real Platform HTTP/OAuth verifier and learner composition, synthetic data ports. */
export async function startLocalStand(learning: LearnerMcpDependencies) {
  const auth = await startSyntheticAuthorizationServer();
  const resource = `${auth.issuer}/mcp/learning`;
  auth.setResource(resource);
  const server = createMcpHttpServer({
    ...refusingMcpToolDependencies(),
    learning,
    accounts: {
      resolveAccount: ({ identity }) =>
        Promise.resolve(
          identity.subject === "synthetic-participant"
            ? {
                ok: true,
                account: { accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
              }
            : { ok: false, error: { code: "account_not_found" } },
        ),
    },
    config: { host: "127.0.0.1", port: 0, serverUrl: `${auth.issuer}/mcp` },
    identityIssuer: auth.issuer,
    tokenVerifier: createLogtoAccessTokenVerifier({
      issuer: auth.issuer,
      audience: resource,
      jwks: { keys: [auth.publicJwk] },
    }),
    readiness: {
      live: () => ({
        process: "mcp",
        release: { release: "synthetic", sourceSha: "0".repeat(40) },
        status: "alive",
      }),
      check: () =>
        Promise.resolve({
          database: "reachable",
          process: "mcp",
          release: { release: "synthetic", sourceSha: "0".repeat(40) },
          schema: { identity: `sha256:${"0".repeat(64)}`, migrationCount: 0 },
          status: "ready",
        }),
    },
  });
  try {
    const endpoint = await server.listen();
    auth.setUpstream(endpoint.origin);
  } catch (error) {
    await auth.close();
    throw error;
  }
  return {
    serverUrl: resource,
    auth,
    async close() {
      await server.close();
      await auth.close();
    },
  };
}
