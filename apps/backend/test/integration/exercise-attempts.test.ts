import { randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { JsonObject } from "@inside/material-blocks";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { assembleMaterials } from "../../src/entrypoints/composition/assemble-materials.js";
import { assembleContentAccess } from "../../src/modules/content-access/index.js";
import { ExerciseAttempts } from "../../src/modules/exercise-attempts/index.js";
import {
  assembleMaterialResourceFacts,
  materialBodyOperations,
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

type Json = JsonObject;

const paragraph = (text: string) => ({
  kind: "paragraph",
  content: [{ kind: "text", text, marks: [] }],
});

function quiz(input: {
  readonly question?: string;
  readonly correct?: string;
  readonly options?: readonly string[];
}): Json {
  const correct = input.correct ?? "prompt";
  return {
    kind: "quiz",
    id: "rag-wrong-platform",
    reveal: "none",
    question: [paragraph(input.question ?? "На каком шаге ошибка?")],
    selectionMode: "single",
    options: (input.options ?? ["embed", "prompt", "rerank"]).map((id) => ({
      id,
      content: [paragraph(`Option ${id}`)],
      correct: id === correct,
      ...(id === correct ? {} : { explanation: [paragraph(`Not ${id}`)] }),
    })),
    dontKnow: {
      explanation: [paragraph("Перечитай раздел")],
      reviewLinks: ["#section"],
    },
  };
}

const order: Json = {
  kind: "order",
  id: "pipeline",
  reveal: "none",
  question: [paragraph("Расставь шаги")],
  steps: ["spec", "code", "ship"].map((id) => ({
    id,
    content: [paragraph(`Step ${id}`)],
    explanation: [paragraph(`Why ${id}`)],
  })),
};

const options = (...optionIds: string[]) => ({
  kind: "options" as const,
  optionIds,
});

function lesson(...exercises: Json[]): MaterialBodySnapshot {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { nodeId: randomUUID(), level: 2 },
          content: [{ type: "text", text: "Section" }],
        },
        ...exercises.map((exercise) => {
          const kind = exercise["kind"];
          if (typeof kind !== "string") throw new Error("Exercise kind");
          return { type: kind, attrs: { nodeId: randomUUID(), exercise } };
        }),
      ],
    },
  };
}

describe("Exercise Attempts on PostgreSQL", () => {
  let database: TestDatabase;
  let materials: ReturnType<typeof assembleMaterials>;
  let attempts: ExerciseAttempts;

  beforeAll(async () => {
    database = await createMigratedTestDatabase();
    await database.prisma.topic.create({
      data: { id: topicId, name: "Exercises", slug: "exercises" },
    });
    await database.prisma.product.create({
      data: {
        id: closedProductId,
        slug: `exercises-${closedProductId}`,
        name: "Exercises closed product",
      },
    });
    materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: (id) => id === actor },
    });
    attempts = new ExerciseAttempts({
      prisma: database.prisma,
      contentAccess: assembleContentAccess({
        materialResourceFacts: assembleMaterialResourceFacts(
          materials.materialContent,
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
      materialContent: materials.materialContent,
      materialBodyOperations,
    });
  });
  afterAll(async () => {
    await database.dispose();
  });

  const metadata = (access: "free" | "closed") => ({
    title: `Lesson ${randomUUID()}`,
    summary: "Exercise attempts",
    topicId,
    formatId: "note",
    access,
    tagIds: [],
    difficulty: null,
    outcomes: [],
    productIds: access === "closed" ? [closedProductId] : [],
  });

  async function publish(
    body: MaterialBodySnapshot,
    access: "free" | "closed" = "free",
  ) {
    const created = await materials.authoring.createDraft({
      actor,
      idempotencyKey: randomUUID(),
      metadata: metadata(access),
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
    return {
      materialId: published.value.materialId,
      contentVersion: published.value.contentVersion,
      access,
    };
  }

  async function republish(
    material: Awaited<ReturnType<typeof publish>>,
    body: MaterialBodySnapshot,
    publicationState: "published" | "unpublished" = "published",
  ) {
    const saved = await materials.authoring.saveMaterial({
      actor,
      materialId: material.materialId,
      expectedContentVersion: material.contentVersion,
      idempotencyKey: randomUUID(),
      publicationState,
      metadata: metadata(material.access),
      body,
    });
    if (!saved.ok) throw new Error(saved.error.code);
    return { ...material, contentVersion: saved.value.contentVersion };
  }

  test("records every check with a server-side result and marks the first attempt per version", async () => {
    const material = await publish(lesson(quiz({}), order));
    const accountId = randomUUID();
    const record = (exerciseId: string, answer: unknown) =>
      attempts.recordAttempt({
        accountId,
        materialId: material.materialId,
        exerciseId,
        answer,
      });

    const first = await record("rag-wrong-platform", options("embed"));
    expect(first).toMatchObject({
      ok: true,
      value: {
        exerciseId: "rag-wrong-platform",
        answer: options("embed"),
        result: "incorrect",
        firstForVersion: true,
      },
    });
    const second = await record("rag-wrong-platform", options("prompt"));
    expect(second).toMatchObject({
      ok: true,
      value: { result: "correct", firstForVersion: false },
    });
    expect(
      await record("pipeline", {
        kind: "sequence",
        stepIds: ["spec", "code", "ship"],
      }),
    ).toMatchObject({
      ok: true,
      value: { result: "correct", firstForVersion: true },
    });
    if (!first.ok || !second.ok) throw new Error("Attempts must record");
    expect(second.value.fingerprint).toBe(first.value.fingerprint);

    const read = await attempts.readAttempts({
      accountId,
      materialId: material.materialId,
    });
    expect(read).toMatchObject({
      ok: true,
      value: [
        {
          exerciseId: "pipeline",
          result: "correct",
        },
        {
          exerciseId: "rag-wrong-platform",
          answer: options("prompt"),
          result: "correct",
          fingerprint: first.value.fingerprint,
        },
      ],
    });
  });

  test("another Account sees none of these attempts and starts its own first attempt", async () => {
    const material = await publish(lesson(quiz({})));
    const owner = randomUUID();
    const other = randomUUID();
    await attempts.recordAttempt({
      accountId: owner,
      materialId: material.materialId,
      exerciseId: "rag-wrong-platform",
      answer: options("prompt"),
    });
    expect(
      await attempts.readAttempts({
        accountId: other,
        materialId: material.materialId,
      }),
    ).toEqual({ ok: true, value: [] });
    expect(
      await attempts.recordAttempt({
        accountId: other,
        materialId: material.materialId,
        exerciseId: "rag-wrong-platform",
        answer: options("embed"),
      }),
    ).toMatchObject({ ok: true, value: { firstForVersion: true } });
  });

  test("a reworded exercise keeps its version; a changed key starts a new one", async () => {
    let material = await publish(lesson(quiz({})));
    const accountId = randomUUID();
    const record = () =>
      attempts.recordAttempt({
        accountId,
        materialId: material.materialId,
        exerciseId: "rag-wrong-platform",
        answer: options("prompt"),
      });
    const before = await record();
    material = await republish(
      material,
      lesson(quiz({ question: "Где ошибка?" })),
    );
    const reworded = await record();
    material = await republish(material, lesson(quiz({ correct: "rerank" })));
    const changed = await record();
    if (!before.ok || !reworded.ok || !changed.ok)
      throw new Error("Attempts must record");
    expect(reworded.value).toMatchObject({
      fingerprint: before.value.fingerprint,
      firstForVersion: false,
    });
    expect(changed.value).toMatchObject({
      result: "incorrect",
      firstForVersion: true,
    });
    expect(changed.value.fingerprint).not.toBe(before.value.fingerprint);
  });

  test("concurrent first checks of one version keep exactly one first attempt", async () => {
    const material = await publish(lesson(quiz({})));
    const accountId = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        attempts.recordAttempt({
          accountId,
          materialId: material.materialId,
          exerciseId: "rag-wrong-platform",
          answer: options("embed"),
        }),
      ),
    );
    expect(
      results.filter((result) => result.ok && result.value.firstForVersion),
    ).toHaveLength(1);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  test("rejects answers that do not fit, unknown exercises and Materials the reader cannot read", async () => {
    const material = await publish(lesson(quiz({})));
    const accountId = randomUUID();
    const record = (input: Partial<Json>) =>
      attempts.recordAttempt({
        accountId,
        materialId: material.materialId,
        exerciseId: "rag-wrong-platform",
        answer: options("prompt"),
        ...input,
      });
    expect(await record({ answer: options("embed", "prompt") })).toEqual({
      ok: false,
      error: { code: "answer_mismatch" },
    });
    expect(
      await record({ answer: { kind: "sequence", stepIds: ["prompt"] } }),
    ).toEqual({ ok: false, error: { code: "answer_mismatch" } });
    expect(await record({ answer: { kind: "options" } })).toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(await record({ exerciseId: "Not An Id" })).toEqual({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(await record({ exerciseId: "missing" })).toEqual({
      ok: false,
      error: { code: "exercise_not_found" },
    });
    expect(await record({ materialId: randomUUID() })).toEqual({
      ok: false,
      error: { code: "exercise_not_found" },
    });

    const closed = await publish(lesson(quiz({})), "closed");
    expect(await record({ materialId: closed.materialId })).toEqual({
      ok: false,
      error: { code: "access_denied" },
    });
    const member = randomUUID();
    await grantProductFixture(database.prisma, member, closedProductId);
    expect(
      await attempts.recordAttempt({
        accountId: member,
        materialId: closed.materialId,
        exerciseId: "rag-wrong-platform",
        answer: options("prompt"),
      }),
    ).toMatchObject({ ok: true, value: { result: "correct" } });

    await republish(material, lesson(quiz({})), "unpublished");
    expect(await record({})).toEqual({
      ok: false,
      error: { code: "exercise_not_found" },
    });
    expect(
      await attempts.readAttempts({
        accountId,
        materialId: material.materialId,
      }),
    ).toEqual({ ok: true, value: [] });
  });

  test("«Не знаю» is recorded only where the author offered it", async () => {
    const material = await publish(lesson(quiz({}), order));
    const accountId = randomUUID();
    const dontKnow = (exerciseId: string) =>
      attempts.recordAttempt({
        accountId,
        materialId: material.materialId,
        exerciseId,
        answer: { kind: "dontKnow" },
      });
    expect(await dontKnow("rag-wrong-platform")).toMatchObject({
      ok: true,
      value: { result: "dontKnow", firstForVersion: true },
    });
    expect(await dontKnow("pipeline")).toEqual({
      ok: false,
      error: { code: "answer_mismatch" },
    });
  });
});

describe("Exercise Attempts over Nest HTTP", () => {
  let app: NestFastifyApplication;
  let server: DeclaredServer;
  let database: TestDatabase;
  let identity: TestIdentityIssuer;
  let freeMaterialId: string;
  let closedMaterialId: string;

  beforeAll(async () => {
    identity = await startTestIdentityIssuer({
      issuer: "https://identity.exercise-attempts.test/oidc",
      audience: "https://api.exercise-attempts.test",
    });
    database = await createMigratedTestDatabase();
    await database.prisma.topic.create({
      data: { id: topicId, name: "Exercises", slug: "exercises" },
    });
    await database.prisma.product.create({
      data: {
        id: closedProductId,
        slug: `exercises-${closedProductId}`,
        name: "Exercises closed product",
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
          summary: "Exercise attempts",
          topicId,
          formatId: "note",
          access,
          tagIds: [],
          difficulty: null,
          outcomes: [],
          productIds: access === "closed" ? [closedProductId] : [],
        },
        body: lesson(quiz({})),
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
    freeMaterialId = await publish("free");
    closedMaterialId = await publish("closed");
    app = await createApiApplication(
      parsePlatformConfig({
        NODE_ENV: "test",
        DATABASE_URL: database.url,
        LOGTO_ISSUER: identity.issuer,
        LOGTO_AUDIENCE: identity.audience,
        LOGTO_JWKS_URL: identity.jwksUrl,
        IDENTITY_EMAIL_FINGERPRINT_KEY: "exercise-attempts-fingerprint-key",
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

  async function signedIn(): Promise<{
    readonly bearer: string;
    readonly accountId: string;
  }> {
    const subject = `exercise-attempts-${randomUUID()}`;
    const bearer = await identity.sign(subject, {
      inside_verified_email: `${subject}@example.test`,
    });
    const created = await server.inject({
      method: "POST",
      url: "/accounts",
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(created.statusCode).toBe(201);
    const account = await database.prisma.account.findFirstOrThrow({
      where: { logtoSubject: subject },
    });
    return { bearer, accountId: account.id };
  }

  const attemptUrl = (materialId: string, exerciseId = "rag-wrong-platform") =>
    `/exercise-attempts/materials/${materialId}/exercises/${exerciseId}`;

  function record(
    bearer: string | null,
    materialId: string,
    payload: Json,
    exerciseId?: string,
  ) {
    return server.inject({
      method: "POST",
      url: attemptUrl(materialId, exerciseId),
      headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
      payload,
    });
  }
  function read(bearer: string | null, materialId: string) {
    return server.inject({
      method: "GET",
      url: `/exercise-attempts/materials/${materialId}`,
      headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    });
  }

  test("a guest can neither record nor read attempts", async () => {
    expect(
      (await record(null, freeMaterialId, { answer: options("prompt") }))
        .statusCode,
    ).toBe(401);
    expect((await read(null, freeMaterialId)).statusCode).toBe(401);
  });

  test("a signed-in reader records and reads back only their own attempts", async () => {
    const reader = await signedIn();
    const other = await signedIn();
    const recorded = await record(reader.bearer, freeMaterialId, {
      answer: options("prompt"),
    });
    expect(recorded.statusCode).toBe(200);
    expect(recorded.json()).toMatchObject({
      exerciseId: "rag-wrong-platform",
      answer: options("prompt"),
      result: "correct",
      firstForVersion: true,
    });
    const own = await read(reader.bearer, freeMaterialId);
    expect(own.statusCode).toBe(200);
    expect(own.json()).toMatchObject({
      items: [{ exerciseId: "rag-wrong-platform", result: "correct" }],
    });
    expect((await read(other.bearer, freeMaterialId)).json()).toEqual({
      items: [],
    });
  });

  test("the request cannot set the result, the Account or another field", async () => {
    const reader = await signedIn();
    const other = await signedIn();
    for (const payload of [
      { answer: options("embed"), result: "correct" },
      { answer: options("embed"), accountId: other.accountId },
      { answer: { kind: "options", optionIds: ["embed"], result: "correct" } },
      {},
    ])
      expect(
        (await record(reader.bearer, freeMaterialId, payload)).statusCode,
      ).toBe(400);
    expect(
      (
        await record(reader.bearer, freeMaterialId, {
          answer: options("embed"),
        })
      ).json(),
    ).toMatchObject({ result: "incorrect" });
    expect((await read(other.bearer, freeMaterialId)).json()).toEqual({
      items: [],
    });
  });

  test("maps a wrong answer shape, an unknown exercise and a closed Material to their statuses", async () => {
    const reader = await signedIn();
    expect(
      (
        await record(reader.bearer, freeMaterialId, {
          answer: { kind: "sequence", stepIds: ["prompt"] },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await record(
          reader.bearer,
          freeMaterialId,
          { answer: options("prompt") },
          "missing",
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await record(reader.bearer, "not-a-uuid", {
          answer: options("prompt"),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await record(reader.bearer, closedMaterialId, {
          answer: options("prompt"),
        })
      ).statusCode,
    ).toBe(403);
    await grantProductFixture(
      database.prisma,
      reader.accountId,
      closedProductId,
    );
    expect(
      (
        await record(reader.bearer, closedMaterialId, {
          answer: options("prompt"),
        })
      ).statusCode,
    ).toBe(200);
  });
});
