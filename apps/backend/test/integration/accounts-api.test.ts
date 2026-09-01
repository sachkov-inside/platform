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

    const malformedOptionalProof =
      await app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: "/materials/missing-material",
        headers: { authorization: "Bearer not-a-jwt" },
      });
    expect(malformedOptionalProof.statusCode).toBe(401);
    expect(malformedOptionalProof.json()).toMatchObject({
      code: "invalid_proof",
    });
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
    await database.prisma.series.create({
      data: { id: seriesId, name: "Platform", slug: "platform" },
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
        "Initial API contract.",
      ),
    });
    expect(created.statusCode).toBe(201);
    expect(created.headers["cache-control"]).toBe("private, no-store");
    const initial = readMaterialReceipt(created.json<unknown>());

    const companion = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/authoring/materials",
      headers: {
        ...authorization,
        "idempotency-key": "authoring-create-companion-001",
      },
      payload: materialDraftPayload(
        "Playlist companion",
        "Companion.",
      ),
    });
    expect(companion.statusCode).toBe(201);
    const companionReceipt = readMaterialReceipt(companion.json<unknown>());

    const initialOrder = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: `/authoring/series/${seriesId}/order`,
      headers: authorization,
    });
    expect(initialOrder.statusCode).toBe(200);
    const initialOrderBody = initialOrder.json<{
      readonly items: readonly { readonly materialId: string }[];
      readonly orderVersion: string;
    }>();
    expect(initialOrderBody.items.map(({ materialId }) => materialId)).toEqual([
      initial.materialId,
      companionReceipt.materialId,
    ]);

    const reordered = await app.getHttpAdapter().getInstance().inject({
      method: "PUT",
      url: `/authoring/series/${seriesId}/order`,
      headers: authorization,
      payload: {
        expectedOrderVersion: initialOrderBody.orderVersion,
        orderedMaterialIds: [companionReceipt.materialId, initial.materialId],
      },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json()).toMatchObject({ seriesId });

    const staleOrder = await app.getHttpAdapter().getInstance().inject({
      method: "PUT",
      url: `/authoring/series/${seriesId}/order`,
      headers: authorization,
      payload: {
        expectedOrderVersion: initialOrderBody.orderVersion,
        orderedMaterialIds: [initial.materialId, companionReceipt.materialId],
      },
    });
    expect(staleOrder.statusCode).toBe(409);
    const staleOrderBody = staleOrder.json<{
      readonly code: string;
      readonly currentOrderVersion?: string;
    }>();
    expect(staleOrderBody.code).toBe("stale_series_order");
    expect(staleOrderBody.currentOrderVersion).toMatch(/^[a-f0-9]{64}$/u);

    const corpus = await app.getHttpAdapter().getInstance().inject({
      method: "GET",
      url: "/authoring/materials?search=generated&publicationState=draft&page=1",
      headers: authorization,
    });
    expect(corpus.statusCode).toBe(200);
    expect(corpus.headers["cache-control"]).toBe("private, no-store");
    expect(corpus.json()).toMatchObject({
      items: [
        {
          contentVersion: 1,
          format: { id: formatId, name: "Guide" },
          materialId: initial.materialId,
          publicationState: "draft",
          title: "Generated API contract",
          topic: { id: topicId, name: "Architecture" },
        },
      ],
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    });

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
          "Current API contract.",
          "membership",
        ),
      },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      materialId: current.materialId,
      contentVersion: 3,
      publicationState: "published",
    });

    const authorizedReader = await inject(
      "GET",
      "/materials/generated-api-contract-v2",
      token,
    );
    expect(authorizedReader.statusCode).toBe(200);
    expect(authorizedReader.headers["cache-control"]).toBe(
      "private, no-store",
    );
    expect(authorizedReader.json()).toMatchObject({
      kind: "available",
      projection: { access: "membership" },
    });

    const authorizedCatalog = await inject(
      "GET",
      "/library/materials",
      token,
    );
    expect(authorizedCatalog.statusCode).toBe(200);
    expect(authorizedCatalog.headers["cache-control"]).toBe(
      "private, no-store",
    );
    const catalog = authorizedCatalog.json<{
      readonly items: readonly {
        readonly access: string;
        readonly availability: string;
        readonly slug: string;
      }[];
    }>();
    expect(
      catalog.items.find(({ slug }) => slug === "generated-api-contract-v2"),
    ).toMatchObject({
      slug: "generated-api-contract-v2",
      access: "membership",
      availability: "available",
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

    const deletable = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/authoring/materials",
      headers: {
        ...authorization,
        "idempotency-key": "authoring-create-deletable-001",
      },
      payload: materialDraftPayload("Delete through API", "Delete safely."),
    });
    expect(deletable.statusCode).toBe(201);
    const deletableReceipt = readMaterialReceipt(deletable.json<unknown>());
    const deleteRequest = {
      method: "DELETE" as const,
      url: `/authoring/materials/${deletableReceipt.materialId}`,
      headers: {
        ...authorization,
        "idempotency-key": "authoring-delete-001",
      },
      payload: { expectedContentVersion: 1 },
    };
    const deleted = await app.getHttpAdapter().getInstance().inject(deleteRequest);
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ materialId: deletableReceipt.materialId });
    const duplicateDelete = await app
      .getHttpAdapter()
      .getInstance()
      .inject(deleteRequest);
    expect(duplicateDelete.statusCode).toBe(200);
    expect(duplicateDelete.json()).toEqual({
      materialId: deletableReceipt.materialId,
    });

    const forbiddenDelete = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: `/authoring/materials/${current.materialId}`,
      headers: {
        ...authorization,
        "idempotency-key": "authoring-delete-published-001",
      },
      payload: { expectedContentVersion: 4 },
    });
    expect(forbiddenDelete.statusCode).toBe(409);
    expect(forbiddenDelete.json()).toMatchObject({
      code: "draft_deletion_forbidden",
    });
  });

  test("keeps private Account and active-member Profile projections separate", async () => {
    const ownerToken = await signToken({
      subject: "profile-owner-001",
      email: "profile-owner@example.test",
    });
    const viewerToken = await signToken({
      subject: "profile-viewer-001",
      email: "profile-viewer@example.test",
    });
    const nonMemberToken = await signToken({
      subject: "profile-non-member-001",
      email: "profile-non-member@example.test",
    });
    const ownerAccountId = readAccountId(
      (await inject("POST", "/accounts", ownerToken)).json<unknown>(),
    );
    const viewerAccountId = readAccountId(
      (await inject("POST", "/accounts", viewerToken)).json<unknown>(),
    );
    await inject("POST", "/accounts", nonMemberToken);

    const missing = await inject("GET", "/account/profile", ownerToken);
    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toEqual({ kind: "missing" });
    expect(missing.headers["cache-control"]).toBe("private, no-store");

    const created = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/account/profile",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        displayName: "Кирилл Сачков",
        bio: "Инженер и автор.",
      },
    });
    expect(created.statusCode).toBe(201);
    const privateProfile = readPrivateProfile(created.json<unknown>());
    expect(privateProfile).toMatchObject({
      displayName: "Кирилл Сачков",
      bio: "Инженер и автор.",
      status: "active",
      version: 1,
    });

    for (const request of [
      app.getHttpAdapter().getInstance().inject({
        method: "GET",
        url: `/member-profiles/${privateProfile.publicProfileId}`,
      }),
      inject(
        "GET",
        `/member-profiles/${privateProfile.publicProfileId}`,
        nonMemberToken,
      ),
    ]) {
      const denied = await request;
      expect(denied.statusCode).toBe(404);
      expect(denied.headers["cache-control"]).toBe("private, no-store");
      expect(denied.json()).toMatchObject({ code: "profile_not_found" });
    }

    const checkedAt = new Date();
    const validUntil = new Date(checkedAt.getTime() + 60 * 60 * 1_000);
    await database.prisma.membershipBinding.create({
      data: {
        accountId: viewerAccountId,
        principalRef: "profile-viewer-principal",
        linkedAt: checkedAt,
      },
    });
    await database.prisma.membershipProjection.create({
      data: {
        accountId: viewerAccountId,
        principalRef: "profile-viewer-principal",
        decision: "member",
        evidenceRef: "profile-viewer-evidence",
        evidenceVersion: 1n,
        evidenceFingerprint: "a".repeat(64),
        checkedAt,
        validUntil,
        updatedAt: checkedAt,
      },
    });

    const visible = await inject(
      "GET",
      `/member-profiles/${privateProfile.publicProfileId}`,
      viewerToken,
    );
    expect(visible.statusCode).toBe(200);
    expect(visible.headers["cache-control"]).toBe("private, no-store");
    expect(visible.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(visible.json()).toEqual({
      profile: {
        avatar: null,
        publicProfileId: privateProfile.publicProfileId,
        displayName: "Кирилл Сачков",
        bio: "Инженер и автор.",
      },
    });
    expect(JSON.stringify(visible.json())).not.toMatch(
      /accountId|email|logto|telegram|permission|evidence|audit/iu,
    );

    const removedReportRoute = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: `/member-profiles/${privateProfile.publicProfileId}/reports`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { reason: "unsafe_content" },
    });
    expect(removedReportRoute.statusCode).toBe(404);

    const updated = await app.getHttpAdapter().getInstance().inject({
      method: "PUT",
      url: "/account/profile",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        expectedVersion: 1,
        displayName: "Кирилл",
        bio: null,
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(readPrivateProfile(updated.json<unknown>())).toMatchObject({
      displayName: "Кирилл",
      bio: null,
      version: 2,
    });

    const conflict = await app.getHttpAdapter().getInstance().inject({
      method: "PUT",
      url: "/account/profile",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        expectedVersion: 1,
        displayName: "Проигравшая запись",
        bio: null,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({
      code: "conflict",
      currentVersion: 2,
    });

    const currentProjection = await inject(
      "GET",
      `/member-profiles/${privateProfile.publicProfileId}`,
      viewerToken,
    );
    expect(currentProjection.statusCode).toBe(200);
    expect(currentProjection.json()).toMatchObject({
      profile: { displayName: "Кирилл", bio: null },
    });

    const removedExportRoute = await inject(
      "GET",
      "/account/profile/export",
      ownerToken,
    );
    expect(removedExportRoute.statusCode).toBe(404);

    const removedDeleteRoute = await app.getHttpAdapter().getInstance().inject({
      method: "DELETE",
      url: "/account/profile",
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { expectedVersion: 2 },
    });
    expect(removedDeleteRoute.statusCode).toBe(404);
    await expect(
      database.prisma.memberProfileAuditEvent.findMany({
        where: { accountId: ownerAccountId },
        orderBy: { createdAt: "asc" },
        select: { event: true },
      }),
    ).resolves.toEqual([
      { event: "profile_created" },
      { event: "profile_updated" },
    ]);
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
const seriesId = "73000000-0000-4000-8000-000000000003";

function materialDraftPayload(
  title: string,
  text: string,
  access: "free" | "membership" = "free",
) {
  return {
    metadata: {
      title,
      summary: "A Material authoring API integration fixture.",
      access,
      topicId,
      formatId,
      tagIds: [],
      seriesIds: [seriesId],
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

function readPrivateProfile(value: unknown): {
  readonly publicProfileId: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly status: string;
  readonly version: number;
} {
  if (
    typeof value !== "object" ||
    value === null ||
    !("profile" in value) ||
    typeof value.profile !== "object" ||
    value.profile === null ||
    !("publicProfileId" in value.profile) ||
    typeof value.profile.publicProfileId !== "string" ||
    !("displayName" in value.profile) ||
    typeof value.profile.displayName !== "string" ||
    !("bio" in value.profile) ||
    (typeof value.profile.bio !== "string" && value.profile.bio !== null) ||
    !("status" in value.profile) ||
    typeof value.profile.status !== "string" ||
    !("version" in value.profile) ||
    typeof value.profile.version !== "number"
  ) {
    throw new TypeError("Member Profile API response has no private Profile");
  }
  return {
    publicProfileId: value.profile.publicProfileId,
    displayName: value.profile.displayName,
    bio: value.profile.bio,
    status: value.profile.status,
    version: value.profile.version,
  };
}
