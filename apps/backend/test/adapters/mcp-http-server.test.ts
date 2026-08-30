import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createMcpHttpServer, type McpHttpServer } from "../../src/entrypoints/mcp/mcp-http-server.js";
import type { Accounts } from "../../src/modules/accounts/index.js";
import { createLogtoAccessTokenVerifier } from "../../src/modules/accounts/infrastructure/idp/logto/logto-access-token-verifier.js";
import { stubMaterialAuthoring } from "../fixtures/material-authoring.js";

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("MCP Streamable HTTP adapter", () => {
  let privateKey: CryptoKey;
  let endpoint: URL;
  let server: McpHttpServer;

  beforeAll(async () => {
    const keys = await generateKeyPair("ES384");
    privateKey = keys.privateKey;
    const publicJwk = {
      ...(await exportJWK(keys.publicKey)),
      alg: "ES384",
      kid: "mcp-http-test-key",
    };
    server = createMcpHttpServer({
      accounts: fakeAccounts(),
      authoring: stubMaterialAuthoring(),
      config: {
        host: "127.0.0.1",
        port: 0,
        serverUrl: "http://127.0.0.1:0/mcp",
      },
      identityIssuer: issuer,
      tokenVerifier: createLogtoAccessTokenVerifier({
        issuer,
        audience,
        jwks: { keys: [publicJwk] },
      }),
    });
    endpoint = await server.listen();
  });

  afterAll(async () => {
    await server.close();
  });

  test("serves authenticated tools over Streamable HTTP", async () => {
    const client = new Client({ name: "mcp-http-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(endpoint, {
      authProvider: { token: () => signToken("owner-001") },
    });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map(({ name }) => name)).toEqual([
        "material_create_draft",
        "material_load",
        "material_save",
        "material_preview",
      ]);
    } finally {
      await client.close();
    }
  });

  test("challenges missing, invalid, expired, and unknown-Account proofs", async () => {
    const cases = [
      undefined,
      "not-a-jwt",
      await signToken("owner-001", { expiresAt: currentTime() - 60 }),
      await signToken("unknown-account"),
    ];

    for (const token of cases) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: "{}",
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(
        "resource_metadata=",
      );
      await expect(response.json()).resolves.toMatchObject({
        error: "invalid_token",
      });
    }
  });

  test("publishes Logto-compatible protected resource metadata", async () => {
    const metadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", endpoint);
    const response = await fetch(metadataUrl);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      resource: "http://127.0.0.1:0/mcp",
      authorization_servers: [issuer],
      bearer_methods_supported: ["header"],
      resource_name: "Sachkov Inside Platform Material authoring",
    });
  });

  test("rejects an untrusted browser Origin before authentication", async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { origin: "https://attacker.example.test" },
      body: "{}",
    });

    expect(response.status).toBe(403);
  });

  function signToken(
    subject: string,
    overrides: { readonly expiresAt?: number } = {},
  ): Promise<string> {
    const issuedAt = currentTime();
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES384", kid: "mcp-http-test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt(issuedAt)
      .setExpirationTime(overrides.expiresAt ?? issuedAt + 300)
      .sign(privateKey);
  }
});

function fakeAccounts(): Accounts {
  return {
    establishAccount: () =>
      Promise.resolve({
        ok: false,
        error: { code: "invalid_input" },
      }),
    resolveAccount: ({ identity }) =>
      Promise.resolve(
        identity.subject === "owner-001"
          ? { ok: true, account: { accountId } }
          : { ok: false, error: { code: "account_not_found" } },
      ),
    checkPermission: () => Promise.resolve({ ok: true, allowed: false }),
  };
}

function currentTime(): number {
  return Math.floor(Date.now() / 1_000);
}
