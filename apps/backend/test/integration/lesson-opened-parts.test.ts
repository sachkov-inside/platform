import { linkTelegram } from "../support/telegram-links.js";
import { registerFixedClock } from "../support/fixed-clock.js";

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { declaredServer } from "../support/declared-api.js";

registerFixedClock();

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";

/** Opened lesson parts of step-by-step reveal (#2122): a personal fact behind the reader's access. */
describe("Lesson opened parts HTTP", () => {
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
    await new Promise<void>((resolve) =>
      jwksServer.listen(0, "127.0.0.1", resolve),
    );
    const address = jwksServer.address();
    if (address === null || typeof address === "string")
      throw new Error("missing JWKS port");

    database = await createMigratedTestDatabase();
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: issuer,
        LOGTO_AUDIENCE: audience,
        LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
        IDENTITY_EMAIL_FINGERPRINT_KEY:
          "accounts-api-test-email-fingerprint-key",
      }),
      { logger: false },
    );
    await app.init();
    await declaredServer(app.getHttpAdapter().getInstance()).ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await new Promise<void>((resolve, reject) =>
      jwksServer.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
  });

  test("an Account saves only its own parts of a lesson it may read, and they never shrink", async () => {
    const token = await signToken();
    const otherToken = await signToken({
      subject: "another",
      email: "another@example.test",
    });
    const server = declaredServer(app.getHttpAdapter().getInstance());
    for (const bearer of [token, otherToken])
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/accounts",
            headers: { authorization: `Bearer ${bearer}` },
          })
        ).statusCode,
      ).toBe(201);
    for (const logtoSubject of ["human-api-001", "another"])
      await linkTelegram(database.prisma, { logtoSubject });
    const lesson = await publishLesson("free");
    const closedLesson = await publishLesson("closed");
    const headers = { authorization: `Bearer ${token}` };
    const url = `/reading-activity/materials/${lesson}/opened-parts`;

    expect(
      (
        await server.inject({
          method: "PUT",
          url,
          payload: { openedParts: 2 },
        })
      ).statusCode,
    ).toBe(401);
    for (const payload of [
      { openedParts: 0 },
      { openedParts: 1001 },
      { openedParts: 1.5 },
      { openedParts: "2" },
      { openedParts: 2, accountId: randomUUID() },
      {},
    ])
      expect(
        (await server.inject({ method: "PUT", url, headers, payload }))
          .statusCode,
      ).toBe(400);
    expect(
      (
        await server.inject({
          method: "PUT",
          url: "/reading-activity/materials/not-a-uuid/opened-parts",
          headers,
          payload: { openedParts: 2 },
        })
      ).statusCode,
    ).toBe(400);
    const denied = await server.inject({
      method: "PUT",
      url: `/reading-activity/materials/${closedLesson}/opened-parts`,
      headers,
      payload: { openedParts: 2 },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "access_denied" });
    const missing = await server.inject({
      method: "PUT",
      url: `/reading-activity/materials/${randomUUID()}/opened-parts`,
      headers,
      payload: { openedParts: 2 },
    });
    expect(missing.statusCode).toBe(403);

    const saved = await server.inject({
      method: "PUT",
      url,
      headers,
      payload: { openedParts: 3 },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.headers["cache-control"]).toBe("private, no-store");
    expect(saved.json()).toEqual({ openedParts: 3 });
    // A late request from an older tab cannot close parts the reader has already opened.
    const older = await server.inject({
      method: "PUT",
      url,
      headers,
      payload: { openedParts: 2 },
    });
    expect(older.json()).toEqual({ openedParts: 3 });

    const states = async (bearer: string) =>
      (
        await server.inject({
          method: "POST",
          url: "/reading-activity/materials/query",
          headers: { authorization: `Bearer ${bearer}` },
          payload: { materialIds: [lesson, closedLesson] },
        })
      ).json<readonly { materialId: string; openedParts: number | null }[]>();
    expect(
      (await states(token)).map(({ materialId, openedParts }) => ({
        materialId,
        openedParts,
      })),
    ).toEqual([
      { materialId: lesson, openedParts: 3 },
      { materialId: closedLesson, openedParts: null },
    ]);
    expect(
      (await states(otherToken)).map((state) => state.openedParts),
    ).toEqual([null, null]);
  });

  async function publishLesson(access: "free" | "closed"): Promise<string> {
    const actor = randomUUID();
    const topicId = randomUUID();
    const productId = randomUUID();
    await database.prisma.topic.create({
      data: { id: topicId, name: `Topic ${access}`, slug: `topic-${access}` },
    });
    await database.prisma.product.create({
      data: { id: productId, name: `Product ${access}`, slug: access },
    });
    const materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: () => true },
    });
    const created = await materials.authoring.createDraft({
      actor,
      idempotencyKey: randomUUID(),
      metadata: {
        title: `Lesson ${access}`,
        summary: "Step reveal",
        access,
        topicId,
        formatId: "note",
        tagIds: [],
        difficulty: null,
        outcomes: [],
        productIds: [productId],
      },
      body: representativeDocument("Lesson text."),
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.transitionPublication({
      actor,
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      idempotencyKey: randomUUID(),
    });
    if (!published.ok) throw new Error(published.error.code);
    const materialId = published.value.materialId;
    const order = await materials.authoring.loadProductOrder({
      actor,
      productId,
    });
    if (!order.ok) throw new Error(order.error.code);
    const programme = await materials.authoring.reorderProduct({
      actor,
      productId,
      expectedOrderVersion: order.value.orderVersion,
      orderedMaterialIds: [materialId],
      programmePlacements: [
        { id: randomUUID(), materialId, chapterId: null, stepGroup: null },
      ],
    });
    if (!programme.ok) throw new Error(programme.error.code);
    return materialId;
  }

  async function signToken(
    overrides: { readonly subject?: string; readonly email?: string } = {},
  ): Promise<string> {
    // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      inside_verified_email: overrides.email ?? "member@example.test",
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
