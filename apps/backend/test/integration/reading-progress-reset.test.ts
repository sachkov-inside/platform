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

/** Resetting a chapter: the Account's studied marks and opened lesson parts start over. */
describe("Reading progress reset HTTP", () => {
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

  test("an Account resets only its own marks and opened parts of the given Materials, once per command", async () => {
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
    const first = await publishLesson("free");
    const second = await publishLesson("free");
    const untouched = await publishLesson("free");
    const headers = { authorization: `Bearer ${token}` };
    const otherHeaders = { authorization: `Bearer ${otherToken}` };
    for (const [materialId, bearer] of [
      [first, headers],
      [untouched, headers],
      [first, otherHeaders],
    ] as const) {
      const marked = await server.inject({
        method: "PUT",
        url: `/reading-activity/materials/${materialId}`,
        headers: bearer,
        payload: { isRead: true, expectedVersion: 0, commandId: randomUUID() },
      });
      expect(marked.statusCode).toBe(200);
      const parts = await server.inject({
        method: "PUT",
        url: `/reading-activity/materials/${materialId}/opened-parts`,
        headers: bearer,
        payload: { openedParts: 3 },
      });
      expect(parts.statusCode).toBe(200);
    }
    const url = "/reading-activity/materials/reset";
    const commandId = randomUUID();

    expect(
      (
        await server.inject({
          method: "POST",
          url,
          payload: { materialIds: [first], commandId },
        })
      ).statusCode,
    ).toBe(401);
    for (const payload of [
      { materialIds: [], commandId },
      { materialIds: ["not-a-uuid"], commandId },
      {
        materialIds: Array.from({ length: 101 }, () => randomUUID()),
        commandId,
      },
      { materialIds: [first] },
      { materialIds: [first], commandId, accountId: randomUUID() },
    ])
      expect(
        (await server.inject({ method: "POST", url, headers, payload }))
          .statusCode,
      ).toBe(400);

    const reset = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { materialIds: [second, first, first], commandId },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.headers["cache-control"]).toBe("private, no-store");
    expect(reset.json()).toEqual({ resetCount: 1, replayed: false });

    const states = async (bearer: Readonly<Record<string, string>>) =>
      (
        await server.inject({
          method: "POST",
          url: "/reading-activity/materials/query",
          headers: bearer,
          payload: { materialIds: [first, second, untouched] },
        })
      )
        .json<
          readonly {
            materialId: string;
            isRead: boolean;
            version: number;
            openedParts: number | null;
          }[]
        >()
        .map(({ materialId, isRead, version, openedParts }) => ({
          materialId,
          isRead,
          version,
          openedParts,
        }));
    expect(await states(headers)).toEqual([
      { materialId: first, isRead: false, version: 2, openedParts: null },
      { materialId: second, isRead: false, version: 0, openedParts: null },
      { materialId: untouched, isRead: true, version: 1, openedParts: 3 },
    ]);
    // Another Account keeps its own progress of the same lesson.
    expect((await states(otherHeaders))[0]).toEqual({
      materialId: first,
      isRead: true,
      version: 1,
      openedParts: 3,
    });
    const events = await database.prisma.readingEvent.findMany({
      where: { materialId: first, commandId },
    });
    expect(events.map((event) => event.eventType)).toEqual([
      "material_marked_unread",
    ]);

    // A retried command answers from its receipt and changes nothing new.
    const replay = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { materialIds: [first, second], commandId },
    });
    expect(replay.json()).toEqual({ resetCount: 1, replayed: true });
    const reused = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { materialIds: [untouched], commandId },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: "command_conflict" });
    expect((await states(headers))[2]).toMatchObject({ isRead: true });
  });

  async function publishLesson(access: "free" | "closed"): Promise<string> {
    const key = `${access}-${randomUUID().slice(0, 8)}`;
    const actor = randomUUID();
    const topicId = randomUUID();
    const productId = randomUUID();
    await database.prisma.topic.create({
      data: { id: topicId, name: `Topic ${key}`, slug: `topic-${key}` },
    });
    await database.prisma.product.create({
      data: { id: productId, name: `Product ${key}`, slug: key },
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
