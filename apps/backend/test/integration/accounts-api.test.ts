import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
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

  test("protects and executes the complete Material authoring HTTP lifecycle", async () => {
    const token = await signToken({
      subject: "material-author-001",
      email: "author@example.test",
    });
    const established = await inject("POST", "/accounts", token);
    expect(established.statusCode).toBe(201);
    const accountId = readAccountId(established.json<unknown>());
    const authorization = { authorization: `Bearer ${token}` };

    const forbidden = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/authoring/materials",
      headers: {
        ...authorization,
        "idempotency-key": "authoring-forbidden-001",
      },
      payload: materialDraftPayload(
        "Forbidden draft",
        "forbidden-draft",
        "Forbidden.",
      ),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(forbidden.json()).toMatchObject({ code: "forbidden" });

    await database.prisma.accountPermission.create({
      data: { accountId, permission: "materials:manage" },
    });
    await database.prisma.topic.create({
      data: { id: topicId, name: "Architecture", slug: "architecture" },
    });
    await database.prisma.format.create({
      data: { id: formatId, name: "Guide", slug: "guide" },
    });

    const created = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/authoring/materials",
      headers: {
        ...authorization,
        "idempotency-key": "authoring-create-001",
      },
      payload: materialDraftPayload(
        "Generated API contract",
        "generated-api-contract",
        "Initial API contract.",
      ),
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("private, no-store");
    const initial = readMaterialReceipt(created.json<unknown>());

    const loaded = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/authoring/materials/${initial.materialId}`,
      headers: authorization,
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toMatchObject({
      materialId: initial.materialId,
      contentVersion: 1,
      publicationState: "draft",
      metadata: { title: "Generated API contract" },
    });

    const saved = await app.getHttpAdapter().getInstance().inject({
      method: "PUT",
      url: `/authoring/materials/${initial.materialId}`,
      headers: {
        ...authorization,
        "idempotency-key": "authoring-save-001",
      },
      payload: {
        expectedContentVersion: 1,
        publicationState: "draft",
        ...materialDraftPayload(
          "Generated API contract v2",
          "generated-api-contract",
          "Current API contract.",
        ),
      },
    });
    expect(saved.statusCode).toBe(200);
    const current = readMaterialReceipt(saved.json<unknown>());
    expect(current.contentVersion).toBe(2);

    const validation = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/authoring/materials/${current.materialId}/validation?expectedContentVersion=2`,
      headers: authorization,
    });
    expect(validation.statusCode).toBe(200);
    expect(validation.headers["cache-control"]).toBe("private, no-store");

    const preview = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/authoring/materials/${current.materialId}/preview`,
      headers: authorization,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers["cache-control"]).toBe("private, no-store");

    const published = await app.getHttpAdapter().getInstance().inject({
      method: "PUT",
      url: `/authoring/materials/${current.materialId}`,
      headers: {
        ...authorization,
        "idempotency-key": "authoring-publish-001",
      },
      payload: {
        expectedContentVersion: 2,
        publicationState: "published",
        ...materialDraftPayload(
          "Generated API contract v2",
          "generated-api-contract",
          "Current API contract.",
        ),
      },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      materialId: current.materialId,
      contentVersion: 3,
      publicationState: "published",
    });

    const unpublished = await app.getHttpAdapter().getInstance().inject({
      method: "PUT",
      url: `/authoring/materials/${initial.materialId}`,
      headers: {
        ...authorization,
        "idempotency-key": "authoring-unpublish-001",
      },
      payload: {
        expectedContentVersion: 3,
        publicationState: "unpublished",
        ...materialDraftPayload(
          "Generated API contract v2",
          "generated-api-contract",
          "Current API contract.",
        ),
      },
    });
    expect(unpublished.statusCode).toBe(200);
    expect(unpublished.json()).toMatchObject({
      materialId: current.materialId,
      contentVersion: 4,
      publicationState: "unpublished",
    });
  });

  function inject(method: "GET" | "POST", url: string, token: string) {
    return app.getHttpAdapter().getInstance().inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function signToken(
    overrides: {
      readonly subject?: string;
      readonly clientId?: string;
      readonly email?: string;
    } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      inside_verified_email: overrides.email ?? "member@example.test",
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

const topicId = "73000000-0000-4000-8000-000000000001";
const formatId = "73000000-0000-4000-8000-000000000002";

function materialDraftPayload(title: string, slug: string, text: string) {
  return {
    metadata: {
      title,
      summary: "A Material authoring API integration fixture.",
      slug,
      access: "free",
      topicId,
      formatId,
      tagIds: [],
      seriesMemberships: [],
    },
    body: representativeDocument(text),
  };
}

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

function readMaterialReceipt(value: unknown): {
  readonly materialId: string;
  readonly contentVersion: number;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("materialId" in value) ||
    typeof value.materialId !== "string" ||
    !("contentVersion" in value) ||
    typeof value.contentVersion !== "number"
  ) {
    throw new TypeError("Material authoring response has no current identity");
  }
  return { materialId: value.materialId, contentVersion: value.contentVersion };
}
