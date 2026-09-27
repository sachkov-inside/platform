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
import { ImportSourcePracticeController } from "../../src/modules/materials/features/import-source-practice/import-source-practice.controller.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { stubMaterialAuthoring } from "../fixtures/material-authoring.js";
import {
  declaredServer,
  type DeclaredServer,
} from "../support/declared-api.js";

const source = {
  practiceId: "synthetic:brief",
  definition: {
    schemaVersion: 1,
    title: "Brief",
    businessInputs: "Business request",
    expectedOutcome: "Brief",
    allowedFreedom: "Any format",
    criteria: [
      {
        id: "requirement",
        requirement: "Preserve requirement",
        acceptableEvidence: ["An explicit scenario"],
      },
    ],
  },
  sourceReference: {
    materialSourceId: "synthetic:lesson",
    materialSourceRevision: "a".repeat(64),
  },
  provenance: {
    repository: "synthetic/fixture",
    commit: "b".repeat(40),
    path: "practice.json",
  },
  publicationState: "published" as const,
};
const receipt = {
  practiceId: source.practiceId,
  practiceVersion: 1,
  definitionDigest: "c".repeat(64),
  materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  boundContentVersion: 1,
  publicationState: "published" as const,
};

@Module({
  controllers: [ImportSourcePracticeController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
    {
      provide: MATERIAL_AUTHORING,
      useValue: stubMaterialAuthoring({
        validateSourcePractice: () =>
          Promise.resolve({ ok: true, value: { valid: true, current: null } }),
        applySourcePractice: () =>
          Promise.resolve({ ok: true, value: receipt }),
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

test("practice import POST responses match their declared 200 schema", async () => {
  const headers = {
    authorization: "Bearer fixture",
    "idempotency-key": "fixture-request",
  };
  const validation = await server.inject({
    method: "POST",
    url: "/authoring/import/practices/validate",
    headers,
    payload: source,
  });
  expect(validation.statusCode).toBe(200);
  expect(validation.json()).toEqual({ valid: true, current: null });
  const applied = await server.inject({
    method: "POST",
    url: "/authoring/import/practices/apply",
    headers,
    payload: {
      ...source,
      materialId: receipt.materialId,
      expectedContentVersion: 1,
      expectedPracticeVersion: null,
    },
  });
  expect(applied.statusCode).toBe(200);
  expect(applied.json()).toEqual(receipt);
  expect(applied.headers["cache-control"]).toBe("private, no-store");
});
test("anonymous and malformed import requests keep declared error boundaries", async () => {
  const missing = await server.inject({
    method: "POST",
    url: "/authoring/import/practices/validate",
    payload: source,
  });
  expect(missing.statusCode).toBe(401);
  const invalid = await server.inject({
    method: "POST",
    url: "/authoring/import/practices/apply",
    headers: {
      authorization: "Bearer fixture",
      "idempotency-key": "fixture-request",
    },
    payload: {},
  });
  expect(invalid.statusCode).toBe(400);
});
