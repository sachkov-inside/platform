import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";

import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { createApiApplication } from "../../src/entrypoints/api/create-api-application.js";
import { assembleApplySourceTask } from "../../src/modules/guide-tasks/features/import-guide-task/import-guide-task.js";
import {
  assembleMaterials,
  GuideDirectory,
} from "../../src/modules/materials/index.js";
import { representativeDocument } from "../fixtures/material-body/representative.js";
import { declaredServer } from "../support/declared-api.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const issuer = "https://identity.example.test/oidc";
const audience = "https://api.example.test";

// An asymmetric matcher is `any`; held as `unknown` it stays out of the typed fixtures.
const anyTimestamp: unknown = expect.any(String);

const definition = {
  schemaVersion: 1 as const,
  situation: "Новичок неделю ждёт доступов.",
  result: ["Новичок входит и получает доступ к репозиториям."],
  freedom: "Стек выбирает участник.",
  criteria: [
    {
      id: "access",
      level: "required" as const,
      requirement: "Доступ выдаётся через платформу.",
      acceptableEvidence: ["Ответ GitHub после выдачи."],
    },
    {
      id: "second-agent",
      level: "additional" as const,
      requirement: "Есть второй агент.",
      acceptableEvidence: ["Инструкция второго агента."],
    },
  ],
};

describe("Guide Task page, programme tasks and the page form over HTTP (#947)", () => {
  let app: NestFastifyApplication;
  let privateKey: CryptoKey;
  let database: TestDatabase;
  let jwksServer: Server;
  const guideId = randomUUID();
  const guideSlug = `tasks-http-${guideId}`;
  const chapterId = randomUUID();
  let anchorId: string;
  const freeCode = `free-${guideId.slice(0, 8)}`;
  const paidCode = `paid-${guideId.slice(0, 8)}`;
  const owner = randomUUID();

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
        IDENTITY_EMAIL_FINGERPRINT_KEY: "guide-tasks-http-fingerprint-key",
      }),
      { logger: false },
    );
    await app.init();
    await declaredServer(app.getHttpAdapter().getInstance()).ready();

    await database.prisma.account.create({
      data: { id: owner, logtoIssuer: issuer, logtoSubject: owner },
    });
    await database.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    const topicId = randomUUID();
    await database.prisma.topic.create({
      data: { id: topicId, slug: `topic-${topicId}`, name: "Tasks" },
    });
    await database.prisma.guide.create({
      data: { id: guideId, slug: guideSlug, name: "AI Engineering" },
    });
    await database.prisma.guideChapter.create({
      data: { id: chapterId, guideId, name: "Глава 1", ordinal: 1 },
    });
    const materials = assembleMaterials({
      prisma: database.prisma,
      authorPolicy: { canManage: () => true },
    });
    const source = { id: `inside-content:anchor-${guideId}` };
    const created = await materials.authoring.createDraft({
      actor: owner,
      idempotencyKey: randomUUID(),
      metadata: {
        title: "Что строим",
        summary: "Вводный урок главы",
        access: "free",
        topicId,
        formatId: "note",
        tagIds: [],
        difficulty: null,
        outcomes: [],
        seriesIds: [guideId],
      },
      body: representativeDocument("Глава 1"),
    });
    if (!created.ok) throw new Error(created.error.code);
    const applied = await materials.authoring.transitionPublication({
      actor: owner,
      materialId: created.value.materialId,
      expectedContentVersion: 1,
      publicationState: "published",
      idempotencyKey: randomUUID(),
    });
    if (!applied.ok) throw new Error(applied.error.code);
    anchorId = applied.value.materialId;
    // The authoring tool names Materials by source; a draft gets its source here.
    await database.prisma.material.update({
      where: { id: anchorId },
      data: {
        sourceId: source.id,
        sourcePath: "chapter-1/anchor.md",
        sourceRevision: "a".repeat(64),
      },
    });
    await database.prisma.guideMembership.update({
      where: {
        seriesId_materialId: { seriesId: guideId, materialId: anchorId },
      },
      data: { chapterId },
    });
    const apply = assembleApplySourceTask({
      prisma: database.prisma,
      directory: new GuideDirectory(database.prisma),
      authorPolicy: { canManage: () => Promise.resolve(true) },
    });
    for (const [code, access, position, after] of [
      [freeCode, "free", 1, source.id],
      [paidCode, "membership", 2, null],
    ] as const) {
      const imported = await apply(
        {
          sourceId: `inside-content:${code}`,
          code,
          guideId,
          chapterId,
          position,
          title: `Задание ${code}`,
          access,
          definition,
          relatedMaterialSourceIds: [source.id],
          afterMaterialSourceId: after,
          publicationState: "published",
          provenance: {
            repository: "sachkov-inside/inside-content",
            commit: "c".repeat(40),
            path: `course/tasks/${code}.yaml`,
          },
          expectedRevision: null,
        },
        { actor: owner, idempotencyKey: randomUUID() },
      );
      if (!imported.ok) throw new Error(imported.error.code);
    }
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

  test("a guest reads the programme tasks, an open free task and a closed paid one; an unknown code is 404", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const programme = await server.inject({
      method: "GET",
      url: `/library/guides/${guideSlug}`,
    });
    expect(programme.statusCode).toBe(200);
    expect(programme.json()).toMatchObject({
      chapters: [
        {
          id: chapterId,
          tasks: [
            {
              code: freeCode,
              access: "free",
              afterMaterialId: anchorId,
              availability: "available",
              lastSubmittedAt: null,
            },
            {
              code: paidCode,
              access: "membership",
              afterMaterialId: null,
              availability: "locked",
              lastSubmittedAt: null,
            },
          ],
        },
      ],
    });
    const open = await server.inject({
      method: "GET",
      url: `/library/guides/${guideSlug}/tasks/${freeCode}`,
    });
    expect(open.statusCode).toBe(200);
    expect(open.headers["cache-control"]).toContain("no-store");
    expect(open.json()).toMatchObject({
      access: "open",
      task: { code: freeCode, version: 1, definition: { criteria: [{}, {}] } },
      reviewProtocol: { version: "3" },
      relatedMaterials: [{ title: "Что строим", availability: "available" }],
      submission: { accepting: true },
    });
    const closed = await server.inject({
      method: "GET",
      url: `/library/guides/${guideSlug}/tasks/${paidCode}`,
    });
    expect(closed.json()).toEqual({
      access: "closed",
      task: {
        code: paidCode,
        title: `Задание ${paidCode}`,
        guide: { slug: guideSlug, name: "AI Engineering" },
        chapter: { name: "Глава 1", ordinal: 1 },
      },
    });
    for (const url of [
      `/library/guides/${guideSlug}/tasks/absent-task`,
      `/library/guides/other-guide/tasks/${freeCode}`,
    ])
      expect((await server.inject({ method: "GET", url })).statusCode).toBe(
        404,
      );
  });

  test("a signed-in learner submits through the form and finds the submission, its version criteria and the programme mark", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const token = await signToken();
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/accounts",
          headers: { authorization: `Bearer ${token}` },
        })
      ).statusCode,
    ).toBe(201);
    const headers = { authorization: `Bearer ${token}` };
    const submissionsUrl = `/accounts/current/guide-tasks/${freeCode}/submissions`;
    expect(
      (await server.inject({ method: "GET", url: submissionsUrl })).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: "POST",
          url: submissionsUrl,
          headers,
          payload: { taskVersion: 1, submissionKey: "k", note: "" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await server.inject({
          method: "POST",
          url: submissionsUrl,
          headers,
          payload: {
            taskVersion: 2,
            submissionKey: randomUUID(),
            note: "Сделал.",
          },
        })
      ).json(),
    ).toMatchObject({
      status: 409,
      code: "task_version_changed",
      currentVersion: 1,
    });
    const submitted = await server.inject({
      method: "POST",
      url: submissionsUrl,
      headers,
      payload: {
        taskVersion: 1,
        submissionKey: randomUUID(),
        note: "Сделал выдачу доступа.\nНе уверен в отзыве.",
        repositoryUrl: "https://github.com/learner/devportal",
        reportText: "Проверил сам: доступ выдаётся.",
      },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({
      code: freeCode,
      taskVersion: 1,
      source: "form",
    });
    const listed = await server.inject({
      method: "GET",
      url: submissionsUrl,
      headers,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      currentVersion: 1,
      versions: [{ version: 1, criteria: definition.criteria }],
      submissions: [
        {
          source: "form",
          taskVersion: 1,
          note: "Сделал выдачу доступа.\nНе уверен в отзыве.",
          reportText: "Проверил сам: доступ выдаётся.",
          repositoryUrl: "https://github.com/learner/devportal",
          authorFeedback: null,
        },
      ],
    });
    const programme = await server.inject({
      method: "GET",
      url: `/library/guides/${guideSlug}`,
      headers,
    });
    const marks = z
      .object({
        chapters: z.array(
          z
            .object({
              tasks: z.array(
                z
                  .object({
                    code: z.string(),
                    lastSubmittedAt: z.string().nullable(),
                  })
                  .loose(),
              ),
            })
            .loose(),
        ),
      })
      .loose()
      .parse(programme.json());
    expect(
      marks.chapters[0]?.tasks.map((task) => [
        task.code,
        task.lastSubmittedAt !== null,
      ]),
    ).toEqual([
      [freeCode, true],
      [paidCode, false],
    ]);
    expect(
      (
        await server.inject({
          method: "GET",
          url: `/accounts/current/guide-tasks/${paidCode}/submissions`,
          headers,
        })
      ).statusCode,
    ).toBe(404);
  });

  test("the author lists submissions and writes feedback the learner reads; without materials:manage both answer 403 (#948)", async () => {
    const server = declaredServer(app.getHttpAdapter().getInstance());
    const learner = { authorization: `Bearer ${await signToken()}` };
    const author = {
      authorization: `Bearer ${await signToken(owner, "owner@example.test")}`,
    };
    const listUrl = `/authoring/guide-tasks/submissions?guideId=${guideId}&taskCode=${freeCode}`;
    expect(
      (await server.inject({ method: "GET", url: listUrl })).statusCode,
    ).toBe(401);
    const denied = await server.inject({
      method: "GET",
      url: listUrl,
      headers: learner,
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "forbidden" });

    const listed = await server.inject({
      method: "GET",
      url: listUrl,
      headers: author,
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.headers["cache-control"]).toContain("no-store");
    const submissionId = z
      .object({
        submissions: z.array(z.object({ submissionId: z.uuid() }).loose()),
      })
      .loose()
      .parse(listed.json()).submissions[0]?.submissionId;
    expect(listed.json()).toMatchObject({
      guides: [
        {
          id: guideId,
          chapters: [
            {
              id: chapterId,
              tasks: [{ code: freeCode }, { code: paidCode }],
            },
          ],
        },
      ],
      submissions: [
        {
          source: "form",
          task: { code: freeCode, chapterName: "Глава 1" },
          reportText: "Проверил сам: доступ выдаётся.",
          reviewReport: null,
          serviceMark: {
            repositoryUrl: "https://github.com/learner/devportal",
          },
          authorFeedback: null,
        },
      ],
      versions: [{ code: freeCode, version: 1 }],
      nextCursor: null,
    });

    const feedbackUrl = `/authoring/guide-tasks/submissions/${String(submissionId)}/feedback`;
    const payload = { comment: "Выдача доступа понятна.", reviewed: true };
    expect(
      (
        await server.inject({
          method: "PUT",
          url: feedbackUrl,
          headers: learner,
          payload,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.inject({
          method: "PUT",
          url: feedbackUrl,
          headers: author,
          payload: { comment: 1, reviewed: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await server.inject({
          method: "PUT",
          url: `/authoring/guide-tasks/submissions/${randomUUID()}/feedback`,
          headers: author,
          payload,
        })
      ).statusCode,
    ).toBe(404);
    const saved = await server.inject({
      method: "PUT",
      url: feedbackUrl,
      headers: author,
      payload,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      authorFeedback: {
        comment: "Выдача доступа понятна.",
        reviewedAt: anyTimestamp,
      },
    });
    expect(
      (
        await server.inject({
          method: "GET",
          url: `/accounts/current/guide-tasks/${freeCode}/submissions`,
          headers: learner,
        })
      ).json(),
    ).toMatchObject({
      submissions: [
        {
          submissionId,
          authorFeedback: {
            comment: "Выдача доступа понятна.",
            reviewedAt: anyTimestamp,
          },
        },
      ],
    });
  });

  async function signToken(
    subject = "guide-task-learner",
    email = "learner@example.test",
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({ inside_verified_email: email })
      .setProtectedHeader({ alg: "ES384", kid: "api-key-1" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
  }
});
