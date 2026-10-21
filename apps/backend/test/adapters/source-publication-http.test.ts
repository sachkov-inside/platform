import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
} from "../../src/modules/accounts/index.js";
import { MATERIAL_AUTHORING } from "../../src/modules/materials/index.js";
import { ImportSourceMaterialController } from "../../src/modules/materials/features/import-source-material/import-source-material.controller.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { stubMaterialAuthoring } from "../fixtures/material-authoring.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";

import { PLATFORM_CONFIG } from "../../src/config/platform-config.js";
const source = {
  sourceId: "synthetic:lesson",
  materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  expectedContentVersion: 4,
  publicationState: "unpublished" as const,
};
const receipt = {
  materialId: source.materialId,
  contentVersion: 5,
  publicationState: "unpublished" as const,
  publishedAt: "2026-10-01T00:00:00.000Z",
};
@Module({
  controllers: [ImportSourceMaterialController],
  providers: [
    { provide: PLATFORM_CONFIG, useValue: { mode: "test" } },
    { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
    {
      provide: MATERIAL_AUTHORING,
      useValue: stubMaterialAuthoring({
        transitionSourcePublication: (command) => {
          expect(command).toEqual({
            ...source,
            actor: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            idempotencyKey: "fixture-request",
          });
          return Promise.resolve({ ok: true, value: receipt });
        },
      }),
    },
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
                  identity: { issuer: "synthetic", subject: "author" },
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

test("source publication maps actor and idempotency into the declared receipt", async () => {
  const response = await server.inject({
    method: "POST",
    url: "/authoring/import/materials/publication",
    headers: {
      authorization: "Bearer fixture",
      "idempotency-key": "fixture-request",
    },
    payload: source,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual(receipt);
  expect(response.headers["cache-control"]).toBe("private, no-store");
});
test("publication rejects anonymous requests and content-bearing or malformed commands", async () => {
  expect(
    (
      await server.inject({
        method: "POST",
        url: "/authoring/import/materials/publication",
        payload: source,
      })
    ).statusCode,
  ).toBe(401);
  for (const payload of [
    { ...source, body: {} },
    { ...source, source: {} },
    { ...source, publicationState: "draft" },
    { ...source, expectedContentVersion: 0 },
    { ...source, actor: "injected" },
  ]) {
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/authoring/import/materials/publication",
          headers: {
            authorization: "Bearer fixture",
            "idempotency-key": "fixture-request",
          },
          payload,
        })
      ).statusCode,
    ).toBe(400);
  }
});
