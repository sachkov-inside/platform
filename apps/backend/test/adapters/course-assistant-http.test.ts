import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../../src/modules/accounts/index.js";
import { CourseAssistant } from "../../src/modules/course-assistant/index.js";
import { CourseAssistantController } from "../../src/modules/course-assistant/adapters/nest/course-assistant.controller.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";

const unavailable = Promise.resolve({
  ok: false as const,
  error: { code: "unavailable" as const },
});
const repository = {
  id: 101,
  fullName: "learner/agent-course",
  htmlUrl: "https://github.com/learner/agent-course",
};
let open = false;
const practiceId = "synthetic:practice-brief";
const contextVersion = "c".repeat(64);
const review = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  practiceId,
  kind: "initial" as const,
  state: "completed" as const,
  contextVersion,
  repository: { fullName: repository.fullName, htmlUrl: repository.htmlUrl },
  requestedAt: "2026-09-29T09:00:00.000Z",
  completedAt: "2026-09-29T09:01:00.000Z",
  candidates: null,
  checked: {
    id: "default_branch",
    kind: "default_branch" as const,
    label: "основная ветка main",
    ref: "main",
    commitSha: "1".repeat(40),
    url: `${repository.htmlUrl}/tree/${"1".repeat(40)}`,
  },
  result: {
    practiceStatus: "needs_work" as const,
    summary: "Итог",
    criteria: [
      {
        criterionId: "ownership",
        status: "violation" as const,
        evidence: [
          {
            path: "docs/brief.md",
            startLine: 1,
            endLine: 2,
            url: `${repository.htmlUrl}/blob/${"1".repeat(40)}/docs/brief.md#L1-L2`,
          },
        ],
        explanation: "Нет ограничения доступа.",
        nextStep: "Опиши, кто видит заявку.",
        previousStatus: null,
        changed: false,
      },
    ],
  },
  previousReviewId: null,
  failure: null,
};

const assistant: Pick<CourseAssistant, keyof CourseAssistant> = {
  readParticipantState: () =>
    open
      ? Promise.resolve({
          ok: true,
          value: {
            dataNotice: {
              version: "2026-09-28",
              acknowledgedAt: "2026-09-28T10:00:00.000Z",
            },
            repositoryLink: {
              installationId: 7001,
              repository,
              connectedAt: "2026-09-28T10:00:00.000Z",
              access: "revoked",
            },
          },
        })
      : unavailable,
  acknowledgeDataNotice: () => unavailable,
  beginRepositoryConnection: () => unavailable,
  completeRepositoryConnection: () =>
    open
      ? Promise.resolve({
          ok: false,
          error: { code: "write_access_requested" },
        })
      : unavailable,
  listLinkableRepositories: () => unavailable,
  linkRepository: () => unavailable,
  disconnectRepository: () => unavailable,
  listRepositoryLinks: () => unavailable,
  requestPracticeReview: ({ expectedContextVersion }) =>
    !open
      ? unavailable
      : Promise.resolve(
          expectedContextVersion === contextVersion
            ? {
                ok: true,
                value: {
                  ...review,
                  state: "queued",
                  completedAt: null,
                  checked: null,
                  result: null,
                },
              }
            : {
                ok: false,
                error: {
                  code: "practice_context_version_mismatch",
                  currentContextVersion: contextVersion,
                },
              },
        ),
  chooseReviewCandidate: () =>
    open
      ? Promise.resolve({
          ok: false,
          error: { code: "review_not_awaiting_choice" },
        })
      : unavailable,
  readPracticeConversation: () =>
    open
      ? Promise.resolve({
          ok: true,
          value: {
            practice: {
              practiceId,
              title: "Разобрать обращение бизнеса",
              contextVersion,
              criteria: [
                {
                  id: "ownership",
                  requirement: "Чужой участник не видит заявку.",
                },
              ],
            },
            status: "needs_work",
            activeReview: null,
            messages: [
              {
                id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                role: "participant",
                kind: "text",
                text: "Проверить задание",
                review: null,
                createdAt: "2026-09-29T09:00:00.000Z",
              },
              {
                id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                role: "assistant",
                kind: "review_result",
                text: null,
                review,
                createdAt: "2026-09-29T09:01:00.000Z",
              },
            ],
          },
        })
      : unavailable,
  readPracticeReview: () =>
    open
      ? Promise.resolve({ ok: false, error: { code: "review_not_found" } })
      : unavailable,
};

@Module({
  controllers: [CourseAssistantController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
    { provide: CourseAssistant, useValue: assistant },
    {
      provide: ACCOUNTS,
      useValue: {
        resolveAccount: () =>
          Promise.resolve({
            ok: true,
            account: { accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
          }),
      },
    },
    {
      provide: LOGTO_ACCESS_TOKEN_VERIFIER,
      useValue: {
        verifyAccount: (token: string | undefined) =>
          Promise.resolve(
            token === "fixture"
              ? {
                  ok: true,
                  identity: { issuer: "synthetic", subject: "learner" },
                }
              : { ok: false, error: { code: "invalid_proof" } },
          ),
      },
    },
  ],
})
// oxlint-disable-next-line typescript/no-extraneous-class -- Nest owns this isolated HTTP contract fixture.
class Fixture {}
let app: NestFastifyApplication;
let server: DeclaredServer;
beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(
    Fixture,
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
  server = declaredServer(app.getHttpAdapter().getInstance());
  await server.ready();
});
afterAll(async () => app.close());

const headers = { authorization: "Bearer fixture" };
const completion = {
  state: "s".repeat(43),
  code: "code",
  installationId: 7001,
};

describe("course assistant HTTP", () => {
  test("a closed assistant answers 404 at every address", async () => {
    open = false;
    const requests = [
      { method: "GET", url: "/course-assistant/participant" },
      {
        method: "POST",
        url: "/course-assistant/data-notice/acknowledgement",
        payload: { noticeVersion: "2026-09-28" },
      },
      { method: "POST", url: "/course-assistant/repository-connections" },
      {
        method: "POST",
        url: "/course-assistant/repository-connections/completion",
        payload: completion,
      },
      { method: "GET", url: "/course-assistant/repositories" },
      {
        method: "PUT",
        url: "/course-assistant/repository-link",
        payload: { installationId: 7001, repositoryId: 101 },
      },
      { method: "DELETE", url: "/course-assistant/repository-link" },
      { method: "GET", url: "/course-assistant/author/repository-links" },
      {
        method: "GET",
        url: `/course-assistant/practices/${practiceId}/conversation`,
      },
      {
        method: "POST",
        url: `/course-assistant/practices/${practiceId}/reviews`,
        payload: { expectedContextVersion: contextVersion },
      },
      { method: "GET", url: `/course-assistant/reviews/${review.id}` },
      {
        method: "POST",
        url: `/course-assistant/reviews/${review.id}/candidate`,
        payload: { candidateId: "default_branch" },
      },
    ] as const;
    for (const request of requests) {
      const response = await server.inject({ ...request, headers });
      expect(response.statusCode, request.url).toBe(404);
      expect(response.json()).toMatchObject({
        type: "urn:inside:problem:course_assistant_unavailable",
      });
    }
  });

  test("an open assistant returns the declared participant state and maps refusals", async () => {
    open = true;
    const state = await server.inject({
      method: "GET",
      url: "/course-assistant/participant",
      headers,
    });
    expect(state.statusCode).toBe(200);
    expect(state.headers["cache-control"]).toBe("private, no-store");
    expect(state.json()).toMatchObject({
      repositoryLink: { repository, access: "revoked" },
    });

    const writable = await server.inject({
      method: "POST",
      url: "/course-assistant/repository-connections/completion",
      headers,
      payload: completion,
    });
    expect(writable.statusCode).toBe(422);
    expect(writable.json()).toMatchObject({
      type: "urn:inside:problem:write_access_requested",
    });

    const malformed = await server.inject({
      method: "POST",
      url: "/course-assistant/repository-connections/completion",
      headers,
      payload: { ...completion, installationId: "7001" },
    });
    expect(malformed.statusCode).toBe(400);

    const anonymous = await server.inject({
      method: "GET",
      url: "/course-assistant/participant",
    });
    expect(anonymous.statusCode).toBe(401);
  });

  test("practice reviews: the conversation, a queued review and explicit refusals", async () => {
    open = true;
    const conversation = await server.inject({
      method: "GET",
      url: `/course-assistant/practices/${encodeURIComponent(practiceId)}/conversation`,
      headers,
    });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.headers["cache-control"]).toBe("private, no-store");
    expect(conversation.json()).toMatchObject({
      status: "needs_work",
      messages: [{ text: "Проверить задание" }, { review: { id: review.id } }],
    });

    const queued = await server.inject({
      method: "POST",
      url: `/course-assistant/practices/${encodeURIComponent(practiceId)}/reviews`,
      headers,
      payload: { expectedContextVersion: contextVersion },
    });
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({ id: review.id, state: "queued" });

    const stale = await server.inject({
      method: "POST",
      url: `/course-assistant/practices/${encodeURIComponent(practiceId)}/reviews`,
      headers,
      payload: { expectedContextVersion: "f".repeat(64) },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      type: "urn:inside:problem:practice_context_version_mismatch",
      currentContextVersion: contextVersion,
    });

    const malformed = await server.inject({
      method: "POST",
      url: `/course-assistant/practices/${encodeURIComponent(practiceId)}/reviews`,
      headers,
      payload: {
        expectedContextVersion: contextVersion,
        candidate: { kind: "tag" },
      },
    });
    expect(malformed.statusCode).toBe(400);

    const missing = await server.inject({
      method: "GET",
      url: `/course-assistant/reviews/${review.id}`,
      headers,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      type: "urn:inside:problem:review_not_found",
    });

    const late = await server.inject({
      method: "POST",
      url: `/course-assistant/reviews/${review.id}/candidate`,
      headers,
      payload: { candidateId: "default_branch" },
    });
    expect(late.statusCode).toBe(409);
  });
});
