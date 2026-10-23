import { ProductDiscovery } from "../../src/modules/products/index.js";
import { CoverageCatalog } from "../../src/modules/materials/facets/coverage-catalog/coverage-catalog.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../src/infrastructure/http/problem-details.filter.js";
import {
  activationResponseSchema,
  ownSubscriptionAccessResponseSchema,
  bindingLookupResponseSchema,
} from "../../src/modules/telegram-membership/domain/subscription-activation-wire.js";
import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import schema from "../../../../docs/contracts/subscription-activation-v1/schema.json" with { type: "json" };
import {
  parsePlatformConfig,
  PLATFORM_CONFIG,
} from "../../src/config/platform-config.js";
import {
  assembleAccounts,
  bootstrapOwnerAccount,
} from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { CourseActivation } from "../../src/modules/billing/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { TelegramActivationIntentController } from "../../src/modules/telegram-membership/features/activate-course/telegram-activation-continuation.controller.js";
import { CourseActivationController } from "../../src/modules/telegram-membership/features/activate-course/course-activation.controller.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
const version = "inside.subscription-activation.v1";
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(schema);
const validateResponse = ajv.compile({
  $ref: `${schema.$id}#/definitions/activationResponse`,
});
const validateBinding = ajv.compile({
  $ref: `${schema.$id}#/definitions/bindingResponse`,
});
describe("course activation HTTP authority with real PostgreSQL", () => {
  let db: TestDatabase;
  let http: NestFastifyApplication;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let owner: string;
  let now = new Date("2030-01-01T00:00:00.000Z");
  const secret = "test-subscription-source-authority";
  const otherAuthority = "test-membership-evidence-authority";
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = (
      await bootstrapOwnerAccount(
        db.prisma,
        { issuer: "https://activation.example.test", subject: "owner" },
        "platform:admin",
      )
    ).accountId;
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "activation-test-fingerprint-secret",
    });
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      recipientLinks: new TelegramAccountLinks(db.prisma),
      clock: () => now,
    });
    const service = new CourseActivation({
      prisma: db.prisma,
      grants,
      bindings: new TelegramAccountLinks(db.prisma),
      contentCatalog: new CoverageCatalog(
        db.prisma,
        new ProductDiscovery(db.prisma),
      ),
      readAdmission: () =>
        Promise.resolve({ state: "checking", admissionRestriction: null }),
    });
    @Module({
      controllers: [
        CourseActivationController,
        TelegramActivationIntentController,
      ],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: CourseActivation, useValue: service },
        {
          provide: PLATFORM_CONFIG,
          useValue: parsePlatformConfig({
            NODE_ENV: "test",
            TELEGRAM_ACTIVATION_INGRESS_SECRET: secret,
            TELEGRAM_EVIDENCE_INGRESS_SECRET: otherAuthority,
            TELEGRAM_LINKING_SECRET: "test-linking-authority",
          }),
        },
      ],
    })
    // oxlint-disable-next-line typescript/no-extraneous-class -- Nest requires a concrete fixture module.
    class FixtureModule {}
    http = await NestFactory.create<NestFastifyApplication>(
      FixtureModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await http.init();
    await http.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await http.close();
    await db.dispose();
  });
  async function send(
    path: string,
    payload: object,
    credential: string | null = secret,
  ) {
    const url = `/integrations/telegram/v1/subscription-activation/${path}`;
    const response = await http.inject({
      method: "POST",
      url,
      headers:
        credential === null ? {} : { authorization: `Bearer ${credential}` },
      payload,
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    if (response.statusCode === 200 && path === "binding")
      expect(
        validateBinding(response.json()),
        JSON.stringify(validateBinding.errors),
      ).toBe(true);
    else if (response.statusCode === 200 && path !== "own-access")
      expect(
        validateResponse(response.json()),
        JSON.stringify(validateResponse.errors),
      ).toBe(true);
    return response;
  }
  async function lookup(identityRef: string) {
    const response = await send("binding", {
      contractVersion: version,
      identityRef,
    });
    return bindingLookupResponseSchema.parse(response.json());
  }
  async function linkedSnapshot(identityRef: string) {
    const result = await lookup(identityRef);
    if (!result.ok || result.value.state !== "linked")
      throw new Error("Expected current binding");
    return result.value.binding;
  }
  async function setup() {
    now = new Date("2030-01-01T00:00:00.000Z");
    const id = randomUUID();
    const identityRef = `telegram:${randomUUID()}`;
    const policy = `course:${id}`;
    await db.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://activation.example.test",
        logtoSubject: id,
      },
    });
    const product = await db.prisma.product.create({
      data: { id: randomUUID(), name: "Course", slug: randomUUID() },
    });
    const rule = {
      id: randomUUID(),
      code: randomUUID(),
      name: "Курс",
      productId: product.id,
      sourceRef: policy,
      published: true,
      startsAt: now.toISOString(),
      endsAt: null,
    };
    expect(
      await grants.manageActivationRule(owner, {
        operationId: randomUUID(),
        value: rule,
        reason: "Confirmed course source",
      }),
    ).toMatchObject({ ok: true });
    return { id, identityRef, policy, product, rule };
  }
  test("both rollout routes authenticate only the source authority and keep private exact response shape", async () => {
    const f = await setup();
    const payload = {
      contractVersion: version,
      attemptId: randomUUID(),
      code: f.rule.code,
      identityRef: f.identityRef,
    };
    for (const credential of [
      null,
      "wrong",
      otherAuthority,
      "test-linking-authority",
    ])
      expect((await send("attempts", payload, credential)).statusCode).toBe(
        401,
      );
    const legacy = await send("attempts", payload);
    const canonical = await http.inject({
      method: "POST",
      url: "/integrations/telegram/v1/course-activation/attempts",
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
    expect(canonical.json()).toEqual(legacy.json());
    expect(canonical.headers["cache-control"]).toBe("private, no-store");
    expect(
      (
        await http.inject({
          method: "POST",
          url: "/integrations/telegram/v1/invitations/redeem",
          headers: { authorization: `Bearer ${secret}` },
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  });
  test("binding lookup rejects internal Account selectors and stale binding, fresh proof works and accepted receipt survives unlink", async () => {
    const f = await setup();
    expect(await lookup(f.identityRef)).toMatchObject({
      ok: true,
      value: { state: "unlinked" },
    });
    expect(
      (
        await send("binding", {
          contractVersion: version,
          identityRef: f.identityRef,
          accountId: f.id,
        })
      ).json(),
    ).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    await linkTelegramAccount(db.prisma, {
      accountId: f.id,
      identityRef: f.identityRef,
      now,
    });
    const old = await linkedSnapshot(f.identityRef),
      attemptId = randomUUID();
    await send("attempts", {
      contractVersion: version,
      attemptId,
      code: f.rule.code,
      identityRef: f.identityRef,
    });
    const evidence = {
      contractVersion: version,
      audience: "inside.platform.subscription-activation",
      evidenceRef: randomUUID(),
      attemptId,
      sourceRef: f.policy,
      ...old,
      ruleId: f.rule.id,
      ruleRevision: 1,
      checkedAt: now.toISOString(),
      validUntil: new Date(now.getTime() + 240000).toISOString(),
      decision: "member",
    };
    await db.prisma.telegramLinkTransaction.updateMany({
      where: { accountId: f.id },
      data: { status: "expired" },
    });
    await linkTelegramAccount(db.prisma, {
      accountId: f.id,
      identityRef: f.identityRef,
      now,
    });
    expect((await send("evidence", evidence)).json()).toMatchObject({
      ok: false,
      error: { code: "identity_conflict" },
    });
    expect(
      (await send("own-access", { contractVersion: version, ...old })).json(),
    ).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
    const current = await linkedSnapshot(f.identityRef);
    expect(current.linkRevision).toBeGreaterThan(old.linkRevision);
    const fresh = { ...evidence, ...current, evidenceRef: randomUUID() };
    const accepted = activationResponseSchema.parse(
      (await send("evidence", fresh)).json(),
    );
    expect(accepted).toMatchObject({
      ok: true,
      value: { state: "active", enrollment: null },
    });
    const own = ownSubscriptionAccessResponseSchema.parse(
      (
        await send("own-access", {
          contractVersion: version,
          ...current,
          includeProducts: true,
        })
      ).json(),
    );
    expect(ownSubscriptionAccessResponseSchema.safeParse(own).success).toBe(
      true,
    );
    await db.prisma.telegramLinkTransaction.updateMany({
      where: { accountId: f.id },
      data: { status: "expired" },
    });
    expect((await send("evidence", fresh)).json()).toEqual(accepted);
    expect(
      (
        await send("own-access", { contractVersion: version, ...current })
      ).json(),
    ).toMatchObject({ ok: false });
  });
  test("browser continuation reveals only navigation intent until current matching binding and expires after retention", async () => {
    const f = await setup(),
      attemptId = randomUUID();
    await send("attempts", {
      contractVersion: version,
      attemptId,
      code: f.rule.code,
      identityRef: f.identityRef,
    });
    expect(
      await grants.readActivationContinuation(attemptId, f.id, null),
    ).toEqual({ state: "link_required", ruleId: f.rule.id });
    expect(
      await grants.readActivationContinuation(
        attemptId,
        f.id,
        "other-identity",
      ),
    ).toEqual({ state: "identity_conflict" });
    expect(await grants.readActivationIntent(attemptId)).toEqual({
      state: "ready",
      ruleId: f.rule.id,
    });
    now = new Date("2030-02-02T00:00:00.000Z");
    expect(
      await grants.readActivationContinuation(attemptId, f.id, f.identityRef),
    ).toEqual({ state: "expired" });
  });
});
