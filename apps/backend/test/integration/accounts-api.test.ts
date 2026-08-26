import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import {
  createTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";

describe("Accounts API", () => {
  let app: NestFastifyApplication;
  let privateKey: CryptoKey;
  let database: TestDatabase;
  let jwksServer: Server;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    const publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      alg: "ES384",
      kid: "api-key-1",
    };
    jwksServer = createServer((request, response) => {
      if (request.url !== "/jwks") return void response.writeHead(404).end();
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
    const address = jwksServer.address();
    if (address === null || typeof address === "string") throw new Error("missing JWKS port");

    database = await createTestDatabase();
    await migrateToLatest(database.url);
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: issuer,
        LOGTO_AUDIENCE: audience,
        LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
        IDENTITY_EMAIL_FINGERPRINT_KEY: "accounts-api-test-email-fingerprint-key",
      }),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });

  test("establishes and resolves one Account without a Platform session header", async () => {
    const token = await signToken();
    const established = await inject("POST", "/accounts", token);
    expect(established.statusCode).toBe(201);
    const establishedBody = established.json<unknown>();
    expect(readAccountId(establishedBody)).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.stringify(establishedBody)).not.toContain("member@example.test");

    const resolved = await inject("GET", "/accounts/current", token);
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json<unknown>()).toEqual(establishedBody);
  });

  test("ordinary resolve never provisions and M2M fails the human path", async () => {
    const unknown = await inject(
      "GET",
      "/accounts/current",
      await signToken({ subject: "unknown-account" }),
    );
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toMatchObject({ code: "account_not_found" });

    const machine = await inject(
      "POST",
      "/accounts",
      await signToken({ subject: "service-001", clientId: "service-001" }),
    );
    expect(machine.statusCode).toBe(401);
    expect(machine.json()).toMatchObject({ code: "invalid_proof" });
  });

  function inject(method: "GET" | "POST", url: string, token: string) {
    return app.getHttpAdapter().getInstance().inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function signToken(
    overrides: { readonly subject?: string; readonly clientId?: string } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      inside_verified_email: "member@example.test",
      ...(overrides.clientId === undefined ? {} : { client_id: overrides.clientId }),
    })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(overrides.subject ?? "human-api-001")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});

function readAccountId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("account" in value) ||
    typeof value.account !== "object" ||
    value.account === null ||
    !("accountId" in value.account) ||
    typeof value.account.accountId !== "string"
  ) {
    throw new TypeError("Accounts API response has no accountId");
  }
  return value.account.accountId;
}
