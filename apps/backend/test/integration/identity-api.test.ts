import { createServer, type Server } from "node:http";

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
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

describe("identity API", () => {
  let app: NestFastifyApplication;
  let privateKey: CryptoKey;
  let testDatabase: TestDatabase;
  let jwksServer: Server;

  beforeAll(async () => {
    const pair = await generateKeyPair("ES384");
    privateKey = pair.privateKey;
    const publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "ES384", kid: "api-key-1" };
    jwksServer = createServer((request, response) => {
      if (request.url !== "/jwks") {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, "127.0.0.1", resolve));
    const address = jwksServer.address();
    if (address === null || typeof address === "string") {
      throw new Error("JWKS test server did not bind a TCP port");
    }

    testDatabase = await createTestDatabase();
    await migrateToLatest(testDatabase.database);
    const config = parsePlatformConfig({
      NODE_ENV: "test",
      DATABASE_URL: testDatabase.url,
      LOGTO_ISSUER: issuer,
      LOGTO_AUDIENCE: audience,
      LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
      IDENTITY_EMAIL_FINGERPRINT_KEY: "identity-api-test-email-fingerprint-key",
    });
    app = await createApiApplication(config, { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await testDatabase.dispose();
    await new Promise<void>((resolve, reject) => {
      jwksServer.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  });

  test("maps a Logto JWT through one Principal/session boundary and clears the local session", async () => {
    const token = await signHumanToken();
    const established = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/identity/sessions/human",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-sign-in-001",
      },
    });
    expect(established.statusCode).toBe(201);
    const establishedBody: unknown = established.json();
    expect(establishedBody).toMatchObject({
      subject: { principalKind: "human", permissions: [] },
    });
    expect(JSON.stringify(establishedBody)).not.toContain("member@example.test");
    const sessionRef = readSessionRef(establishedBody);

    const resolved = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/identity/subject",
      headers: {
        authorization: `Bearer ${token}`,
        "x-platform-session": sessionRef,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json<unknown>()).toEqual(establishedBody);

    const begunReauthentication = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/identity/reauthentication-attempts",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-reauth-begin-001",
        "x-platform-session": sessionRef,
      },
    });
    expect(begunReauthentication.statusCode).toBe(201);
    const attemptId = readAttemptId(begunReauthentication.json<unknown>());
    const staleCompletion = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/identity/reauthentication-attempts/${attemptId}/complete`,
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-reauth-stale-001",
        "x-platform-session": sessionRef,
      },
    });
    expect(staleCompletion.statusCode).toBe(401);
    expect(staleCompletion.json()).toMatchObject({
      code: "reauthentication_required",
    });
    const reauthenticationToken = await signHumanToken({
      issuedAtOffsetSeconds: 1,
      jti: "api-jwt-reauth-001",
    });
    const completedReauthentication = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/identity/reauthentication-attempts/${attemptId}/complete`,
      headers: {
        authorization: `Bearer ${reauthenticationToken}`,
        "idempotency-key": "api-reauth-complete-001",
        "x-platform-session": sessionRef,
      },
    });
    expect(completedReauthentication.statusCode).toBe(201);
    expect(readSessionRef(completedReauthentication.json<unknown>())).toBe(sessionRef);

    const ended = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: "/identity/sessions/current",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-sign-out-001",
        "x-platform-session": sessionRef,
      },
    });
    expect(ended.statusCode).toBe(200);
    expect(ended.json()).toEqual({ ended: true });

    const afterLogout = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/identity/subject",
      headers: {
        authorization: `Bearer ${token}`,
        "x-platform-session": sessionRef,
      },
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.headers["content-type"]).toContain("application/problem+json");
    expect(afterLogout.json()).toMatchObject({
      type: "https://inside.sachkov.com/problems/identity/session-ended",
      title: "Identity verification failed",
      status: 401,
      code: "session_ended",
    });
  });

  test("does not interpret a machine-to-machine client subject as a human", async () => {
    const token = await signHumanToken({ clientId: "human-api-001" });
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/identity/sessions/human",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-m2m-human-rejection",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ status: 401, code: "invalid_proof" });
  });

  test("maps a pre-provisioned M2M identity only through the service boundary", async () => {
    const principalId = "72000000-0000-4000-8000-000000000101";
    await testDatabase.database
      .insertInto("principals")
      .values({ id: principalId, kind: "service", state: "active" })
      .execute();
    await testDatabase.database
      .insertInto("external_identities")
      .values({
        id: "72000000-0000-4000-8000-000000000102",
        principal_id: principalId,
        issuer,
        subject: "service-api-001",
        email_fingerprint: null,
      })
      .execute();
    await testDatabase.database
      .insertInto("principal_permissions")
      .values({ principal_id: principalId, permission: "materials:author" })
      .execute();
    const token = await signHumanToken({
      clientId: "service-api-001",
      subject: "service-api-001",
    });

    const established = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/identity/sessions/service",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-service-001",
      },
    });

    expect(established.statusCode).toBe(201);
    expect(established.json()).toMatchObject({
      subject: {
        principalId,
        principalKind: "service",
        permissions: ["materials:author"],
      },
    });
    const sessionRef = readSessionRef(established.json<unknown>());
    const resolved = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/identity/subject/service",
      headers: {
        authorization: `Bearer ${token}`,
        "x-platform-session": sessionRef,
      },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json()).toEqual(established.json());

    const ended = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: "/identity/sessions/service/current",
      headers: {
        authorization: `Bearer ${token}`,
        "idempotency-key": "api-service-end-001",
        "x-platform-session": sessionRef,
      },
    });
    expect(ended.statusCode).toBe(200);
    expect(ended.json()).toEqual({ ended: true });

    const afterEnd = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/identity/subject/service",
      headers: {
        authorization: `Bearer ${token}`,
        "x-platform-session": sessionRef,
      },
    });
    expect(afterEnd.statusCode).toBe(401);
    expect(afterEnd.json()).toMatchObject({ code: "session_ended" });
  });

  async function signHumanToken(
    overrides: {
      readonly clientId?: string;
      readonly issuedAtOffsetSeconds?: number;
      readonly jti?: string;
      readonly subject?: string;
    } = {},
  ): Promise<string> {
    const now =
      Math.floor(Date.now() / 1_000) + (overrides.issuedAtOffsetSeconds ?? 0);
    return new SignJWT({
      inside_verified_email: "member@example.test",
      inside_interactive_at: new Date(now * 1_000).toISOString(),
      ...(overrides.clientId === undefined ? {} : { client_id: overrides.clientId }),
    })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(overrides.subject ?? "human-api-001")
      .setJti(overrides.jti ?? "api-jwt-001")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});

function readSessionRef(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("subject" in value) ||
    typeof value.subject !== "object" ||
    value.subject === null ||
    !("sessionRef" in value.subject) ||
    typeof value.subject.sessionRef !== "string"
  ) {
    throw new TypeError("Identity API response has no sessionRef");
  }
  return value.subject.sessionRef;
}

function readAttemptId(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("attemptId" in value) ||
    typeof value.attemptId !== "string"
  ) {
    throw new TypeError("Identity API response has no attemptId");
  }
  return value.attemptId;
}
