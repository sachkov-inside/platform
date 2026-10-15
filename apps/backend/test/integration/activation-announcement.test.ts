import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../src/infrastructure/http/problem-details.filter.js";
import {
  parsePlatformConfig,
  PLATFORM_CONFIG,
} from "../../src/config/platform-config.js";
import { SubscriptionActivationController } from "../../src/modules/telegram-membership/features/activate-subscription/subscription-activation.controller.js";
import { announcementResponseSchema } from "../../src/modules/telegram-membership/domain/subscription-activation-wire.js";
import { assertDeclaredResponse } from "../support/declared-api.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { SubscriptionActivation } from "../../src/modules/billing/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
const now = new Date("2030-01-01T00:00:00.000Z");
const version = "inside.subscription-activation.v1";
describe("trusted private announcement metadata", () => {
  let db: TestDatabase;
  let activation: SubscriptionActivation;
  let http: NestFastifyApplication;
  const secret = "test-announcement-activation-authority";
  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "announcement-test-fingerprint-secret",
    });
    const bindings = new TelegramAccountLinks(db.prisma);
    const grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      recipientLinks: bindings,
      clock: () => now,
    });
    activation = new SubscriptionActivation({
      prisma: db.prisma,
      grants,
      bindings,
      readAdmission: () =>
        Promise.resolve({ state: "checking", admissionRestriction: null }),
    });
    @Module({
      controllers: [SubscriptionActivationController],
      providers: [
        { provide: SubscriptionActivation, useValue: activation },
        { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        {
          provide: PLATFORM_CONFIG,
          useValue: parsePlatformConfig({
            NODE_ENV: "test",
            TELEGRAM_ACTIVATION_INGRESS_SECRET: secret,
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
  async function setup() {
    const productId = randomUUID();
    const offer = await db.prisma.billingOffer.create({
      data: {
        id: randomUUID(),
        name: "AI Engineering",
        revision: 1,
        availableForAssignment: true,
        benefits: [`product:${productId}`, "support"],
        benefitPeriods: [{ capability: "support", months: 6 }],
        coverage: { productIds: [], materialIds: [] },
      },
    });
    const rule = await db.prisma.activationRule.create({
      data: {
        id: randomUUID(),
        code: randomUUID(),
        name: "SachkovLearn",
        reason: "Owner confirmed course",
        sourceRef: "course",
        revision: 1,
        tierId: offer.id,
        tierRevision: 1,
        verificationMode: "course_membership",
        published: true,
        startsAt: now,
      },
    });
    return { rule, offer, productId };
  }
  test("resolves only a current published rule and its exact Product without creating a learner attempt", async () => {
    const { rule, productId } = await setup();
    expect(
      await activation.announcement({
        contractVersion: version,
        code: rule.code,
      }),
    ).toEqual({
      ok: true,
      value: {
        contractVersion: version,
        rule: { id: rule.id, revision: 1, sourceRef: "course", productId },
      },
    });
    expect(
      await db.prisma.activationAttempt.count({ where: { ruleId: rule.id } }),
    ).toBe(0);
  });
  test("refuses unpublished, expired and mismatched Offer revisions", async () => {
    const { rule, offer } = await setup();
    const query = { contractVersion: version, code: rule.code };
    await db.prisma.activationRule.update({
      where: { id: rule.id },
      data: { published: false },
    });
    expect(await activation.announcement(query)).toEqual({
      ok: false,
      error: { code: "policy_paused" },
    });
    await db.prisma.activationRule.update({
      where: { id: rule.id },
      data: {
        published: true,
        startsAt: new Date("2029-12-31T00:00:00.000Z"),
        endsAt: now,
      },
    });
    expect(await activation.announcement(query)).toEqual({
      ok: false,
      error: { code: "policy_paused" },
    });
    await db.prisma.activationRule.update({
      where: { id: rule.id },
      data: { endsAt: null },
    });
    await db.prisma.billingOffer.update({
      where: { id: offer.id },
      data: { revision: 2 },
    });
    expect(await activation.announcement(query)).toEqual({
      ok: false,
      error: { code: "policy_paused" },
    });
  });
  test("authenticates announcement metadata and returns the declared private read-only contract", async () => {
    const { rule } = await setup();
    const url =
      "/integrations/telegram/v1/subscription-activation/announcement";
    const payload = { contractVersion: version, code: rule.code };
    for (const credential of [
      undefined,
      "other-integration-authority",
      secret,
    ]) {
      const response = await http.inject({
        method: "POST",
        url,
        payload,
        headers:
          credential === undefined
            ? {}
            : { authorization: `Bearer ${credential}` },
      });
      expect(response.statusCode).toBe(credential === secret ? 200 : 401);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      assertDeclaredResponse({
        method: "POST",
        url,
        status: response.statusCode,
        body: () => response.json(),
      });
      if (credential === secret)
        expect(announcementResponseSchema.parse(response.json())).toMatchObject(
          { ok: true, value: { rule: { sourceRef: "course" } } },
        );
    }
  });
});
