import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, test } from "vitest";

import { PLATFORM_CONFIG } from "../../src/config/platform-config.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../../src/modules/accounts/index.js";
import { authoringImportContract } from "../../src/modules/materials/domain/authoring-import-contract.js";
import { ImportSourceMaterialController } from "../../src/modules/materials/features/import-source-material/import-source-material.controller.js";
import { ReadSourceMaterialStateController } from "../../src/modules/materials/features/read-source-material-state/read-source-material-state.controller.js";
import type { SourceMaterialState } from "../../src/modules/materials/features/read-source-material-state/read-source-material-state.contract.js";
import { MATERIAL_AUTHORING } from "../../src/modules/materials/index.js";
import {
  PRODUCT_TASK_IMPORT,
  type ProductTaskImport,
} from "../../src/modules/product-tasks/facets/product-task-import/product-task-import.js";
import type { SourceTaskState } from "../../src/modules/product-tasks/features/read-source-task-state/read-source-task-state.contract.js";
import { ReadSourceTaskStateController } from "../../src/modules/product-tasks/features/read-source-task-state/read-source-task-state.controller.js";
import {
  forbiddenAuthoringResult,
  stubMaterialAuthoring,
} from "../fixtures/material-authoring.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";

const author = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reader = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const materialState: SourceMaterialState = {
  namespace: "inside-content",
  materials: [
    {
      sourceId: "inside-content:lesson",
      materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      slug: "lesson",
      contentVersion: 3,
      access: "closed",
      publicationState: "published",
      source: {
        path: "course/lesson.md",
        revision: "a".repeat(64),
        commit: "c".repeat(40),
        showInFeed: false,
      },
      memberships: [
        {
          productId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          ordinal: 1,
          chapterId: null,
        },
      ],
    },
  ],
};
const taskState: SourceTaskState = {
  namespace: "inside-content",
  tasks: [
    {
      sourceId: "inside-content:first-task",
      taskId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      code: "first-task",
      productId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      chapterId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      position: 1,
      afterMaterialSourceId: "inside-content:lesson",
      programmeVisibility: "standalone",
      embeddedMaterialId: null,
      revision: 2,
      access: "free",
      publicationState: "published",
      sourceCommit: "c".repeat(40),
    },
  ],
};
/** A stub answers only the exact query the adapter must pass; anything else reads as refused. */
function isExpectedQuery(actor: string, namespace: unknown): boolean {
  return actor === author && namespace === "inside-content";
}

function refusedTaskImport(): Promise<{
  readonly ok: false;
  readonly error: { readonly code: "forbidden" };
}> {
  return Promise.resolve({ ok: false, error: { code: "forbidden" } });
}

const taskImport: ProductTaskImport = {
  validate: refusedTaskImport,
  apply: refusedTaskImport,
  readState: (input, context) =>
    Promise.resolve(
      typeof input === "object" &&
        input !== null &&
        Object.keys(input).join() === "namespace" &&
        isExpectedQuery(
          context.actor,
          (input as { namespace?: unknown }).namespace,
        )
        ? { ok: true, value: taskState }
        : { ok: false, error: { code: "forbidden" } },
    ),
};

@Module({
  controllers: [
    ImportSourceMaterialController,
    ReadSourceMaterialStateController,
    ReadSourceTaskStateController,
  ],
  providers: [
    { provide: PLATFORM_CONFIG, useValue: { mode: "test" } },
    { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
    {
      provide: MATERIAL_AUTHORING,
      useValue: stubMaterialAuthoring({
        readSourceMaterialState: (query) =>
          Promise.resolve(
            Object.keys(query).sort().join() === "actor,namespace" &&
              isExpectedQuery(query.actor, query.namespace)
              ? { ok: true, value: materialState }
              : forbiddenAuthoringResult,
          ),
      }),
    },
    { provide: PRODUCT_TASK_IMPORT, useValue: taskImport },
    {
      provide: ACCOUNTS,
      useValue: {
        resolveAccount: (query: {
          readonly identity: { readonly subject: string };
        }) =>
          Promise.resolve({
            ok: true,
            account: {
              accountId: query.identity.subject === "author" ? author : reader,
            },
          }),
      },
    },
    {
      provide: LOGTO_ACCESS_TOKEN_VERIFIER,
      useValue: {
        verifyAccount: (token: string | undefined) =>
          Promise.resolve(
            token === "author" || token === "reader"
              ? { ok: true, identity: { issuer: "synthetic", subject: token } }
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

test("the import environment names the runtime mode and the accepted import contract", async () => {
  const response = await server.inject({
    method: "GET",
    url: "/authoring/import/materials/environment",
    headers: { authorization: "Bearer author" },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({
    mode: "test",
    contract: {
      version: 1,
      packageFeatures: [
        "material-task-v1",
        "task-c-v2",
        "quiz-v1",
        "quiz-multiple-v1",
        "github-anchors-v1",
        "image-variants-v1",
        "collapsible-callouts-v1",
        "bounded-content-v1",
      ],
    },
  });
  expect(response.json()).toEqual({
    mode: "test",
    contract: authoringImportContract,
  });
});

test.each([
  ["Materials", "/authoring/import/materials/state", materialState],
  ["Product Tasks", "/authoring/import/tasks/state", taskState],
] as const)(
  "the %s state read passes the namespace and the actor and answers the declared shape",
  async (_label, path, state) => {
    const response = await server.inject({
      method: "GET",
      url: `${path}?namespace=inside-content`,
      headers: { authorization: "Bearer author" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(state);
    expect(response.headers["cache-control"]).toBe("private, no-store");
  },
);

test.each([
  ["Materials", "/authoring/import/materials/state"],
  ["Product Tasks", "/authoring/import/tasks/state"],
] as const)(
  "the %s state read refuses anonymous, unauthorized and malformed requests",
  async (_label, path) => {
    expect(
      (
        await server.inject({
          method: "GET",
          url: `${path}?namespace=inside-content`,
        })
      ).statusCode,
    ).toBe(401);
    const forbidden = await server.inject({
      method: "GET",
      url: `${path}?namespace=inside-content`,
      headers: { authorization: "Bearer reader" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: "forbidden" });
    // A malformed namespace never reaches the stub, which would answer 403.
    for (const query of [
      "",
      "?namespace=",
      "?namespace=Inside",
      "?namespace=inside%25",
      "?namespace=inside_content",
      "?namespace=inside:content",
      "?namespace=a&namespace=b",
    ]) {
      const response = await server.inject({
        method: "GET",
        url: `${path}${query}`,
        headers: { authorization: "Bearer author" },
      });
      expect(response.statusCode, query).toBe(400);
      expect(response.json()).toMatchObject({ code: "invalid_request_shape" });
    }
  },
);
