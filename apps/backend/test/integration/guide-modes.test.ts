import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { migrateToLatest } from "../../src/migrations/index.js";
import { assembleMaterials } from "../../src/modules/materials/index.js";
import {
  fullRepresentativeDocument,
  representativeDocument,
} from "../fixtures/material-body/representative.js";
import { createTestDatabase, type TestDatabase } from "./setup/test-database.js";

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";
const actor = randomUUID();

describe("Guide modes and lesson facts", () => {
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
    if (address === null || typeof address === "string") {
      throw new Error("missing JWKS port");
    }

    database = await createTestDatabase();
    await migrateToLatest(database.url);
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: issuer,
        LOGTO_AUDIENCE: audience,
        LOGTO_JWKS_URL: `http://127.0.0.1:${String(address.port)}/jwks`,
        IDENTITY_EMAIL_FINGERPRINT_KEY: "guide-modes-test-email-fingerprint-key",
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

  test("the reader owns one stored mode, and another Account never sees it", async () => {
    const server = app.getHttpAdapter().getInstance();
    const reader = await signToken();
    const other = await signToken({ subject: "other", email: "other@example.test" });
    for (const bearer of [reader, other]) {
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/accounts",
            headers: { authorization: `Bearer ${bearer}` },
          })
        ).statusCode,
      ).toBe(201);
    }
    const headers = { authorization: `Bearer ${reader}` };

    expect(
      (await server.inject({ method: "GET", url: "/reading-activity/guide-mode" }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: "PUT",
          url: "/reading-activity/guide-mode",
          payload: { guideMode: "own" },
        })
      ).statusCode,
    ).toBe(401);

    // Читатель, который ни разу не выбирал, проходит руководство по учебному проекту.
    const initial = await server.inject({
      method: "GET",
      url: "/reading-activity/guide-mode",
      headers,
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.headers["cache-control"]).toBe("private, no-store");
    expect(initial.json()).toEqual({ guideMode: "example" });

    expect(
      (
        await server.inject({
          method: "PUT",
          url: "/reading-activity/guide-mode",
          headers,
          payload: { guideMode: "third" },
        })
      ).statusCode,
    ).toBe(400);

    const saved = await server.inject({
      method: "PUT",
      url: "/reading-activity/guide-mode",
      headers,
      payload: { guideMode: "own" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ guideMode: "own" });
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/reading-activity/guide-mode",
          headers,
        })
      ).json(),
    ).toEqual({ guideMode: "own" });

    // Последняя запись выигрывает: читатель, переключивший режим дважды, получает второй выбор.
    await server.inject({
      method: "PUT",
      url: "/reading-activity/guide-mode",
      headers,
      payload: { guideMode: "example" },
    });
    expect(
      (
        await server.inject({
          method: "GET",
          url: "/reading-activity/guide-mode",
          headers,
        })
      ).json(),
    ).toEqual({ guideMode: "example" });

    expect(
      (
        await server.inject({
          method: "GET",
          url: "/reading-activity/guide-mode",
          headers: { authorization: `Bearer ${other}` },
        })
      ).json(),
    ).toEqual({ guideMode: "example" });
  });

  test("a Guide reports mode variants from its own published composition", async () => {
    const materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: () => true },
    });
    const topicId = randomUUID();
    await database.prisma.topic.create({
      data: { id: topicId, name: "Режимы", slug: "modes" },
    });
    const withVariants = randomUUID();
    const withoutVariants = randomUUID();
    await database.prisma.guide.create({
      data: { id: withVariants, name: "С вариантами", slug: "with-variants" },
    });
    await database.prisma.guide.create({
      data: { id: withoutVariants, name: "Без вариантов", slug: "without-variants" },
    });

    const lesson = await publish({
      body: fullRepresentativeDocument(),
      difficulty: "advanced",
      guideId: withVariants,
      materials,
      outcomes: ["Пройти шаг на образце", "Повторить его у себя"],
      title: "Шаг для обоих режимов",
      topicId,
    });
    await publish({
      body: representativeDocument("Один способ на всех."),
      difficulty: null,
      guideId: withoutVariants,
      materials,
      outcomes: [],
      title: "Обычный шаг",
      topicId,
    });

    const server = app.getHttpAdapter().getInstance();
    const variants = await server.inject({
      method: "GET",
      url: "/library/guides/with-variants",
    });
    expect(variants.statusCode).toBe(200);
    expect(variants.json()).toMatchObject({
      reference: { hasModeVariants: true },
    });
    // Сложность и обещание урока приезжают в программу вместе с составом.
    expect(variants.json()).toMatchObject({
      items: [
        {
          difficulty: "advanced",
          outcomes: ["Пройти шаг на образце", "Повторить его у себя"],
        },
      ],
    });

    const plain = await server.inject({
      method: "GET",
      url: "/library/guides/without-variants",
    });
    expect(plain.statusCode).toBe(200);
    expect(plain.json()).toMatchObject({ reference: { hasModeVariants: false } });
    expect(plain.json()).toMatchObject({
      items: [{ difficulty: null, outcomes: [] }],
    });

    // Тот же урок читается с теми же фактами и вне программы.
    const reader = await server.inject({
      method: "GET",
      url: `/materials/${lesson.slug}`,
    });
    expect(reader.statusCode).toBe(200);
    expect(reader.json()).toMatchObject({
      projection: {
        difficulty: "advanced",
        outcomes: ["Пройти шаг на образце", "Повторить его у себя"],
      },
    });
  });

  test("publication accepts no promise at all but refuses a single point", async () => {
    const materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: () => true },
    });
    const topicId = randomUUID();
    await database.prisma.topic.create({
      data: { id: topicId, name: "Обещания", slug: "promises" },
    });
    const metadata = {
      access: "free" as const,
      difficulty: "basic" as const,
      formatId: "guide" as const,
      outcomes: ["Единственный пункт"],
      seriesIds: [],
      summary: "Обещание из одного пункта — это не список.",
      tagIds: [],
      title: "Один пункт",
      topicId,
    };
    const created = await materials.authoring.createDraft({
      actor,
      body: representativeDocument("Черновик пишется по одному пункту."),
      idempotencyKey: randomUUID(),
      metadata,
    });
    // Черновик принимает незаконченный список: автор дописывает его после первого пункта.
    if (!created.ok) throw new Error(created.error.code);

    const published = await materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("Черновик пишется по одному пункту."),
      expectedContentVersion: created.value.contentVersion,
      idempotencyKey: randomUUID(),
      materialId: created.value.materialId,
      metadata,
      publicationState: "published",
    });
    expect(published).toMatchObject({
      ok: false,
      error: {
        code: "invalid_content",
        issues: expect.arrayContaining([
          { code: "outcomes_too_few", path: "/metadata/outcomes" },
        ]),
      },
    });

    const withoutPromise = await materials.authoring.saveMaterial({
      actor,
      body: representativeDocument("Черновик пишется по одному пункту."),
      expectedContentVersion: created.value.contentVersion,
      idempotencyKey: randomUUID(),
      materialId: created.value.materialId,
      metadata: { ...metadata, outcomes: [] },
      publicationState: "published",
    });
    expect(withoutPromise).toMatchObject({ ok: true });
  });

  async function publish({
    body,
    difficulty,
    guideId,
    materials,
    outcomes,
    title,
    topicId,
  }: {
    readonly body: ReturnType<typeof representativeDocument>;
    readonly difficulty: "basic" | "intermediate" | "advanced" | null;
    readonly guideId: string;
    readonly materials: ReturnType<typeof assembleMaterials>;
    readonly outcomes: readonly string[];
    readonly title: string;
    readonly topicId: string;
  }) {
    const created = await materials.authoring.createDraft({
      actor,
      body,
      idempotencyKey: randomUUID(),
      metadata: {
        access: "free",
        difficulty,
        formatId: "guide",
        outcomes,
        seriesIds: [guideId],
        summary: `${title} для проверки режимов.`,
        tagIds: [],
        title,
        topicId,
      },
    });
    if (!created.ok) throw new Error(created.error.code);
    const published = await materials.authoring.transitionPublication({
      actor,
      expectedContentVersion: created.value.contentVersion,
      idempotencyKey: randomUUID(),
      materialId: created.value.materialId,
      publicationState: "published",
    });
    if (!published.ok) throw new Error(published.error.code);
    const loaded = await materials.authoring.loadMaterial({
      actor,
      materialId: created.value.materialId,
    });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const slug = loaded.value.metadata.slug;
    if (slug === null) throw new Error("published Material has no slug");
    return { materialId: created.value.materialId, slug };
  }

  async function signToken(
    overrides: { readonly subject?: string; readonly email?: string } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({
      inside_verified_email: overrides.email ?? "reader@example.test",
    })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(overrides.subject ?? "guide-modes-reader")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});
