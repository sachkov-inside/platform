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
});
