import { randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { LessonRatings } from "../../src/modules/lesson-ratings/index.js";
import {
  assembleMaterialResourceFacts,
  type MaterialBodySnapshot,
} from "../../src/modules/materials/index.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";
import { registerFixedClock } from "../support/fixed-clock.js";
import { assemblePriorParticipantsFixture } from "./setup/prior-participants.js";
import { grantProductFixture } from "./setup/product-access.js";
import {
  startTestIdentityIssuer,
  type TestIdentityIssuer,
} from "./setup/test-identity-issuer.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

registerFixedClock();

const actor = randomUUID();
const topicId = randomUUID();
const closedProductId = randomUUID();

const body: MaterialBodySnapshot = {
  schemaVersion: 1,
  doc: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Lesson" }] },
    ],
  },
};

async function seed(database: TestDatabase) {
  await database.prisma.topic.create({
    data: { id: topicId, name: "Ratings", slug: "ratings" },
  });
  await database.prisma.product.create({
    data: {
      id: closedProductId,
      slug: `ratings-${closedProductId}`,
      name: "Ratings closed product",
    },
  });
  const materials = assembleMaterials({
    prisma: database.prisma,
    authorPolicy: { canManage: (id) => id === actor },
  });
  const publish = async (access: "free" | "closed") => {
    const created = await materials.authoring.createDraft({
      actor,
      idempotencyKey: randomUUID(),
      metadata: {
        title: `Lesson ${randomUUID()}`,
        summary: "Lesson ratings",
        topicId,
        formatId: "note",
        access,
        tagIds: [],
        difficulty: null,
        outcomes: [],
        productIds: access === "closed" ? [closedProductId] : [],
      },
      body,
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.transitionPublication({
      actor,
      idempotencyKey: randomUUID(),
      materialId: created.value.materialId,
      expectedContentVersion: created.value.contentVersion,
      publicationState: "published",
    });
    if (!published.ok) throw new Error(published.error.code);
    return published.value.materialId;
  };
  return { materials, publish };
}

describe("Lesson Ratings on PostgreSQL", () => {
  let database: TestDatabase;
  let ratings: LessonRatings;
  let publish: (access: "free" | "closed") => Promise<string>;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    const seeded = await seed(database);
    publish = seeded.publish;
    ratings = new LessonRatings({
      prisma: database.prisma,
      contentAccess: assembleContentAccess({
        materialResourceFacts: assembleMaterialResourceFacts(
          seeded.materials.materialContent,
        ),
        accountPermissions: {
          hasMaterialsManage: () => Promise.resolve(false),
        },
        accountRights: assemblePriorParticipantsFixture({
          prisma: database.prisma,
          // deterministic-test-allow wall-clock: Date is fixed per case by registerFixedClock; production consumers share this virtual Date.
          clock: () => new Date(),
        }),
      }),
      authorPolicy: { canManage: (id) => id === actor },
    });
  });
  afterAll(async () => {
    await database.dispose();
  });

  test("a reader likes a lesson, changes the rating to a dislike and removes it", async () => {
    const materialId = await publish("free");
    const accountId = randomUUID();
    expect(await ratings.readRating({ accountId, materialId })).toEqual({
      ok: true,
      value: null,
    });
    expect(
      await ratings.rate({ accountId, materialId, rating: "like" }),
    ).toEqual({ ok: true, value: "like" });
    expect(await ratings.readRating({ accountId, materialId })).toEqual({
      ok: true,
      value: "like",
    });
    expect(
      await ratings.rate({ accountId, materialId, rating: "dislike" }),
    ).toEqual({ ok: true, value: "dislike" });
    expect(await ratings.countRatings({ actor, materialId })).toEqual({
      ok: true,
      value: { likes: 0, dislikes: 1 },
    });
    expect(await ratings.clearRating({ accountId, materialId })).toEqual({
      ok: true,
      value: null,
    });
    expect(await ratings.readRating({ accountId, materialId })).toEqual({
      ok: true,
      value: null,
    });
    // Removing a rating that is already gone is an answer, not an error.
    expect(await ratings.clearRating({ accountId, materialId })).toEqual({
      ok: true,
      value: null,
    });
  });

  test("each Account has its own rating; the author counts all of them", async () => {
    const materialId = await publish("free");
    const first = randomUUID();
    const second = randomUUID();
    const third = randomUUID();
    await ratings.rate({ accountId: first, materialId, rating: "like" });
    await ratings.rate({ accountId: second, materialId, rating: "like" });
    await ratings.rate({ accountId: third, materialId, rating: "dislike" });
    await ratings.clearRating({ accountId: second, materialId });
    expect(await ratings.readRating({ accountId: first, materialId })).toEqual({
      ok: true,
      value: "like",
    });
    expect(await ratings.readRating({ accountId: second, materialId })).toEqual(
      { ok: true, value: null },
    );
    expect(
      await ratings.readRating({ accountId: randomUUID(), materialId }),
    ).toEqual({ ok: true, value: null });
    expect(await ratings.countRatings({ actor, materialId })).toEqual({
      ok: true,
      value: { likes: 1, dislikes: 1 },
    });
  });

  test("a reader rates only a lesson they may read", async () => {
    const closed = await publish("closed");
    const accountId = randomUUID();
    expect(
      await ratings.rate({ accountId, materialId: closed, rating: "like" }),
    ).toEqual({ ok: false, error: { code: "access_denied" } });
    expect(
      await ratings.rate({
        accountId,
        materialId: randomUUID(),
        rating: "like",
      }),
    ).toEqual({ ok: false, error: { code: "material_not_found" } });
    expect(
      await ratings.rate({
        accountId,
        materialId: closed,
        rating: "love",
      }),
    ).toEqual({ ok: false, error: { code: "invalid_request" } });
    await grantProductFixture(database.prisma, accountId, closedProductId);
    expect(
      await ratings.rate({ accountId, materialId: closed, rating: "like" }),
    ).toEqual({ ok: true, value: "like" });
  });

  test("only an Account that manages Materials counts ratings", async () => {
    const materialId = await publish("free");
    expect(
      await ratings.countRatings({ actor: randomUUID(), materialId }),
    ).toEqual({ ok: false, error: { code: "forbidden" } });
    expect(await ratings.countRatings({ actor, materialId })).toEqual({
      ok: true,
      value: { likes: 0, dislikes: 0 },
    });
  });
});

describe("Lesson Ratings over Nest HTTP", () => {
  let app: NestFastifyApplication;
  let server: DeclaredServer;
  let database: TestDatabase;
  let identity: TestIdentityIssuer;
  let freeMaterialId: string;
  let closedMaterialId: string;

  beforeAll(async () => {
    identity = await startTestIdentityIssuer({
      issuer: "https://identity.lesson-ratings.test/oidc",
      audience: "https://api.lesson-ratings.test",
    });
    database = await createMigratedTestDatabase();
    const seeded = await seed(database);
    freeMaterialId = await seeded.publish("free");
    closedMaterialId = await seeded.publish("closed");
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: identity.issuer,
        LOGTO_AUDIENCE: identity.audience,
        LOGTO_JWKS_URL: identity.jwksUrl,
        IDENTITY_EMAIL_FINGERPRINT_KEY: "lesson-ratings-email-fingerprint-key",
      }),
      { logger: false },
    );
    await app.init();
    server = declaredServer(app.getHttpAdapter().getInstance());
    await server.ready();
  });

  afterAll(async () => {
    await app.close();
    await database.dispose();
    await identity.close();
  });

  async function signedIn(
    permission?: "materials:manage" | "platform:admin",
  ): Promise<string> {
    const subject = `lesson-ratings-${randomUUID()}`;
    const bearer = await identity.sign(subject, {
      inside_verified_email: `${subject}@example.test`,
    });
    const created = await server.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(created.statusCode).toBe(201);
    if (permission !== undefined) {
      const account = await database.prisma.account.findFirstOrThrow({
        where: { logtoSubject: subject },
      });
      await database.prisma.accountPermission.create({
        data: { accountId: account.id, permission },
      });
    }
    return bearer;
  }

  const headers = (bearer: string | null) =>
    bearer === null ? {} : { authorization: `Bearer ${bearer}` };
  const ratingUrl = (materialId: string) =>
    `/lesson-ratings/materials/${materialId}`;

  function read(bearer: string | null, materialId: string) {
    return server.inject({
      method: "GET",
      url: ratingUrl(materialId),
      headers: headers(bearer),
    });
  }
  function rate(bearer: string | null, materialId: string, payload: unknown) {
    return server.inject({
      method: "PUT",
      url: ratingUrl(materialId),
      headers: headers(bearer),
      payload: payload as Record<string, unknown>,
    });
  }
  function clear(bearer: string | null, materialId: string) {
    return server.inject({
      method: "DELETE",
      url: ratingUrl(materialId),
      headers: headers(bearer),
    });
  }
  function counts(bearer: string | null, materialId: string) {
    return server.inject({
      method: "GET",
      url: `/authoring/materials/${materialId}/ratings`,
      headers: headers(bearer),
    });
  }

  test("a guest can neither rate nor read a rating", async () => {
    expect((await read(null, freeMaterialId)).statusCode).toBe(401);
    expect(
      (await rate(null, freeMaterialId, { rating: "like" })).statusCode,
    ).toBe(401);
    expect((await clear(null, freeMaterialId)).statusCode).toBe(401);
  });

  test("a reader sets, changes and removes only their own rating", async () => {
    const reader = await signedIn();
    const other = await signedIn();
    const liked = await rate(reader, freeMaterialId, { rating: "like" });
    expect(liked.statusCode).toBe(200);
    expect(liked.json()).toEqual({ rating: "like" });
    expect((await read(other, freeMaterialId)).json()).toEqual({
      rating: null,
    });
    await rate(other, freeMaterialId, { rating: "dislike" });
    expect(
      (await rate(reader, freeMaterialId, { rating: "dislike" })).json(),
    ).toEqual({ rating: "dislike" });
    const cleared = await clear(reader, freeMaterialId);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ rating: null });
    expect((await read(reader, freeMaterialId)).json()).toEqual({
      rating: null,
    });
    expect((await read(other, freeMaterialId)).json()).toEqual({
      rating: "dislike",
    });
  });

  test("the request names only the rating, for a lesson the reader may read", async () => {
    const reader = await signedIn();
    for (const payload of [
      { rating: "love" },
      { rating: "like", accountId: randomUUID() },
      {},
    ])
      expect((await rate(reader, freeMaterialId, payload)).statusCode).toBe(
        400,
      );
    expect(
      (await rate(reader, "not-a-uuid", { rating: "like" })).statusCode,
    ).toBe(400);
    expect(
      (await rate(reader, closedMaterialId, { rating: "like" })).statusCode,
    ).toBe(403);
    expect(
      (await rate(reader, randomUUID(), { rating: "like" })).statusCode,
    ).toBe(404);
  });

  test("an author reads the counts; a reader gets 403 and a guest 401", async () => {
    const reader = await signedIn();
    await rate(reader, freeMaterialId, { rating: "like" });
    for (const permission of ["materials:manage", "platform:admin"] as const) {
      const author = await signedIn(permission);
      const read = await counts(author, freeMaterialId);
      expect(read.statusCode).toBe(200);
      expect(read.json()).toMatchObject({ likes: expect.any(Number) });
    }
    const denied = await counts(reader, freeMaterialId);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "forbidden" });
    expect((await counts(null, freeMaterialId)).statusCode).toBe(401);
  });
});
