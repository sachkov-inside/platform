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
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { ProblemDetailsFilter } from "../../src/infrastructure/http/problem-details.filter.js";
import { assembleAccounts } from "../../src/modules/accounts/index.js";
import {
  BillingOperations,
  BillingPricing,
  SubscriptionActivation,
} from "../../src/modules/billing/index.js";
import type {
  OwnerOutcome,
  OwnerResult,
} from "../../src/modules/billing/domain/owner-operations.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { invitationRedeemResponseSchema } from "../../src/modules/telegram-membership/domain/subscription-activation-wire.js";
import { InvitationRedemptionController } from "../../src/modules/telegram-membership/features/redeem-invitation/invitation-redemption.controller.js";
import { assertDeclaredResponse } from "../support/declared-api.js";
import { linkTelegramAccount } from "./setup/telegram-link.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

const version = "inside.subscription-activation.v1";
const secret = "test-invitation-activation-authority";
const day = 24 * 60 * 60 * 1000;
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(schema);
const validateRedeemResponse = ajv.compile({
  $ref: `${schema.$id}#/definitions/invitationRedeemResponse`,
});

function success(result: OwnerResult): OwnerOutcome {
  if (!result.ok) throw new Error(result.error.code);
  return result.result;
}
function failure(result: OwnerResult): string {
  if (result.ok) throw new Error(`Unexpected success ${result.result.outcome}`);
  return result.error.code;
}
/** Итог выдачи или отзыва в ответе: код и ссылка в нём есть, их не хранит только журнал. */
function invitation(result: OwnerResult) {
  const outcome = success(result);
  if (outcome.outcome !== "invitation") throw new Error(outcome.outcome);
  const { code, startParameter, link } = outcome.value;
  if (code === undefined || startParameter === undefined || link === undefined)
    throw new Error("Invitation answer lost its code");
  return { ...outcome.value, code, startParameter, link };
}
function invitations(result: OwnerResult) {
  const outcome = success(result);
  if (outcome.outcome !== "invitations") throw new Error(outcome.outcome);
  return outcome;
}

describe("приглашения: выдача владельцем и погашение ботом на PostgreSQL (#908)", () => {
  let db: TestDatabase;
  let http: NestFastifyApplication;
  let operations: BillingOperations;
  let now = new Date("2030-01-01T00:00:00.000Z");
  const owner = randomUUID();
  const outsider = randomUUID();

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    for (const id of [owner, outsider])
      await db.prisma.account.create({
        data: {
          id,
          logtoIssuer: "https://identity.example.test",
          logtoSubject: id,
        },
      });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "billing:manage" },
    });
    const accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-invitation-fingerprint-key-00",
    });
    const links = new TelegramAccountLinks(db.prisma);
    const grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      recipientLinks: links,
      clock: () => now,
    });
    operations = new BillingOperations({
      prisma: db.prisma,
      accounts,
      pricing: new BillingPricing({
        prisma: db.prisma,
        accounts,
        grants,
        clock: () => now,
        sale: { payments: true, subscriptions: true },
      }),
      // Приглашения не трогают платежи и подписки.
      payments: { reconcile: () => Promise.reject(new Error("unused")) },
      subscriptions: { cancel: () => Promise.reject(new Error("unused")) },
      grants,
      bank: undefined,
      clock: () => now,
      botStartUrl: "https://t.me/inside_test_bot",
    });
    const activation = new SubscriptionActivation({
      prisma: db.prisma,
      grants,
      bindings: links,
      readAdmission: () =>
        Promise.resolve({ state: "checking", admissionRestriction: null }),
      siteOrigin: "https://inside.example.test",
    });
    @Module({
      controllers: [InvitationRedemptionController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: HttpCachePolicyInterceptor },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: SubscriptionActivation, useValue: activation },
        {
          provide: PLATFORM_CONFIG,
          useValue: parsePlatformConfig({
            NODE_ENV: "test",
            TELEGRAM_ACTIVATION_INGRESS_SECRET: secret,
            TELEGRAM_EVIDENCE_INGRESS_SECRET: "test-evidence-authority",
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

  /** Offer подписки только по приглашению: продаётся и назначается, если не сказано иное. */
  async function offer(
    overrides: { availableForAssignment?: boolean; published?: boolean } = {},
  ) {
    const id = randomUUID();
    await db.prisma.billingOffer.create({
      data: {
        id,
        name: "Подписка Inside",
        benefits: ["community", "materials"],
        contentScope: { guideIds: [], materialIds: [], allGuides: true },
        availableForAssignment: overrides.availableForAssignment ?? true,
        published: overrides.published ?? true,
        eligibility: "invitation_only",
        revision: 1,
      },
    });
    await db.prisma.billingPaymentOption.create({
      data: {
        id: randomUUID(),
        revision: 1,
        offerId: id,
        mode: "subscription",
        months: 1,
        priceKopecks: 99_000n,
      },
    });
    return id;
  }
  function issue(input: object, operationId = randomUUID()) {
    return operations.execute(owner, {
      operation: "invitations.issue",
      operationId,
      ...input,
    });
  }
  async function account(identityRef?: string) {
    const id = randomUUID();
    await db.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
      },
    });
    if (identityRef !== undefined)
      await linkTelegramAccount(db.prisma, {
        accountId: id,
        identityRef,
        now,
      });
    return id;
  }
  /** Статус ответа на запрос без верного полномочия бота. */
  async function refused(
    code: string,
    identityRef: string,
    credential: string | null,
  ) {
    return (await send(code, identityRef, credential)).statusCode;
  }
  async function redeem(code: string, identityRef: string) {
    const response = await send(code, identityRef, secret);
    expect(response.statusCode).toBe(200);
    expect(
      validateRedeemResponse(response.json()),
      JSON.stringify(validateRedeemResponse.errors),
    ).toBe(true);
    const parsed = invitationRedeemResponseSchema.parse(response.json());
    if (!parsed.ok) throw new Error(parsed.error.code);
    return parsed.value;
  }
  async function send(
    code: string,
    identityRef: string,
    credential: string | null,
  ) {
    const url = "/integrations/telegram/v1/invitations/redeem";
    const response = await http.inject({
      method: "POST",
      url,
      headers:
        credential === null ? {} : { authorization: `Bearer ${credential}` },
      payload: { contractVersion: version, code, identityRef },
    });
    assertDeclaredResponse({
      method: "POST",
      url,
      status: response.statusCode,
      body: () => response.json(),
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    return response;
  }

  test("выдача возвращает ссылку в бота, повтор отдаёт то же приглашение, журнал не хранит заметку", async () => {
    now = new Date("2030-01-01T00:00:00.000Z");
    const offerId = await offer();
    const operationId = randomUUID();
    const note = "Синтетический ник @invited_reader";
    const issued = invitation(
      await issue({ offerId, mode: "purchase", note }, operationId),
    );
    expect(issued).toMatchObject({
      id: operationId,
      offerId,
      offerRevision: 1,
      mode: "purchase",
      giftMonths: null,
      state: "issued",
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 14 * day).toISOString(),
      accountId: null,
    });
    expect(issued.startParameter).toBe(`i_${issued.code}`);
    expect(issued.startParameter.length).toBeLessThan(43);
    expect(issued.link).toBe(
      `https://t.me/inside_test_bot?start=${issued.startParameter}`,
    );
    expect(
      invitation(await issue({ offerId, mode: "purchase", note }, operationId)),
    ).toEqual(issued);
    // Повтор после потерянного ответа отдаёт выданное, даже если Offer тем временем ушёл в архив.
    await db.prisma.billingOffer.update({
      where: { id: offerId },
      data: { archived: true },
    });
    expect(
      invitation(await issue({ offerId, mode: "purchase", note }, operationId)),
    ).toEqual(issued);
    const audit = await db.prisma.billingOwnerCommand.findMany({
      where: { operationId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.operation).toBe("invitations.issue");
    expect(audit[0]?.targetRef).toBe(operationId);
    expect(
      JSON.stringify(audit.map((row) => [row.reason, row.result])),
    ).not.toContain("invited_reader");
    // Код погашает неоткрытое приглашение: журнал его не хранит.
    expect(JSON.stringify(audit.map((row) => row.result))).not.toContain(
      issued.code,
    );
    const listed = invitations(
      await operations.execute(owner, {
        operation: "invitations.list",
        operationId: randomUUID(),
        offerId,
      }),
    );
    expect(listed.items).toEqual([{ ...issued, note }]);
  });

  test("выдача проверяет право владельца, Offer и режим", async () => {
    now = new Date("2030-01-01T00:00:00.000Z");
    const offerId = await offer();
    const notAssignable = await offer({ availableForAssignment: false });
    expect(
      failure(
        await operations.execute(outsider, {
          operation: "invitations.issue",
          operationId: randomUUID(),
          offerId,
          mode: "purchase",
        }),
      ),
    ).toBe("forbidden");
    expect(
      failure(await issue({ offerId: randomUUID(), mode: "purchase" })),
    ).toBe("not_found");
    expect(
      failure(await issue({ offerId, mode: "purchase", giftMonths: 3 })),
    ).toBe("invalid_request");
    expect(failure(await issue({ offerId: notAssignable, mode: "gift" }))).toBe(
      "state_conflict",
    );
    expect(
      failure(await issue({ offerId, mode: "gift", note: "x".repeat(201) })),
    ).toBe("invalid_request");
  });

  test("оплата: закрепление за первой identity, вход, страница оформления и идемпотентный повтор", async () => {
    now = new Date("2030-01-01T00:00:00.000Z");
    const offerId = await offer();
    const issued = invitation(await issue({ offerId, mode: "purchase" }));
    const identityRef = `telegram:${randomUUID()}`;
    const stranger = `telegram:${randomUUID()}`;
    expect(await refused(issued.code, identityRef, null)).toBe(401);
    expect(await refused(issued.code, identityRef, "wrong-authority")).toBe(
      401,
    );
    expect(await redeem(issued.code, identityRef)).toEqual({
      contractVersion: version,
      state: "needs_account",
    });
    expect(await redeem(issued.code, stranger)).toEqual({
      contractVersion: version,
      state: "claimed_by_other",
    });
    // Закреплённое приглашение ждёт входа и после 14 дней на первое открытие.
    now = new Date(now.getTime() + 20 * day);
    const buyer = await account(identityRef);
    const ready = {
      contractVersion: version,
      state: "purchase_ready",
      mode: "purchase",
      offerName: "Подписка Inside",
      checkoutUrl: `https://inside.example.test/subscription?offer=${offerId}`,
    };
    expect(await redeem(issued.code, identityRef)).toEqual(ready);
    expect(await redeem(issued.code, identityRef)).toEqual({
      ...ready,
      state: "already_redeemed",
    });
    expect(await redeem(issued.code, stranger)).toEqual({
      contractVersion: version,
      state: "claimed_by_other",
    });
    const [listed] = invitations(
      await operations.execute(owner, {
        operation: "invitations.list",
        operationId: randomUUID(),
        offerId,
        state: "redeemed",
      }),
    ).items;
    expect(listed).toMatchObject({ state: "redeemed", accountId: buyer });
    expect(
      failure(
        await operations.execute(owner, {
          operation: "invitations.revoke",
          operationId: randomUUID(),
          invitationId: issued.id,
          expectedRevision: listed?.revision ?? 0,
        }),
      ),
    ).toBe("state_conflict");
  });

  test("подарок назначает Enrollment origin invitation на срок или бессрочно, повтор возвращает его же", async () => {
    now = new Date("2030-01-31T09:00:00.000Z");
    const offerId = await offer();
    const identityRef = `telegram:${randomUUID()}`;
    const member = await account(identityRef);
    const termed = invitation(
      await issue({ offerId, mode: "gift", giftMonths: 1 }),
    );
    const granted = await redeem(termed.code, identityRef);
    if (!("enrollment" in granted)) throw new Error("Expected a gift");
    expect(granted).toMatchObject({
      state: "gift_granted",
      mode: "gift",
      enrollment: {
        accountId: member,
        origin: "invitation",
        startsAt: now.toISOString(),
        // Календарный месяц от момента погашения: 31 января — конец февраля.
        endsAt: "2030-02-28T09:00:00.000Z",
        endPolicy: "fixed",
        state: "active",
        tier: { id: offerId, revision: 1 },
      },
    });
    now = new Date(now.getTime() + day);
    const repeated = await redeem(termed.code, identityRef);
    expect(repeated).toMatchObject({
      state: "already_redeemed",
      mode: "gift",
      enrollment: { id: granted.enrollment.id },
    });
    const lifetime = invitation(await issue({ offerId, mode: "gift" }));
    expect(await redeem(lifetime.code, identityRef)).toMatchObject({
      state: "gift_granted",
      enrollment: { origin: "invitation", endsAt: null },
    });
    const enrollments = await db.prisma.subscriptionEnrollment.findMany({
      where: { accountId: member },
    });
    expect(enrollments.map((row) => row.sourceRef).sort()).toEqual(
      [termed.id, lifetime.id].sort(),
    );
  });

  test("неоткрытое сгорает за 14 дней, закреплённое без входа — за 30, отозванное и неизвестное не работают", async () => {
    now = new Date("2030-01-01T00:00:00.000Z");
    const offerId = await offer();
    const unopened = invitation(await issue({ offerId, mode: "purchase" }));
    const opened = invitation(await issue({ offerId, mode: "purchase" }));
    const revoked = invitation(await issue({ offerId, mode: "gift" }));
    const identityRef = `telegram:${randomUUID()}`;
    expect(await redeem(opened.code, identityRef)).toMatchObject({
      state: "needs_account",
    });
    expect(
      invitation(
        await operations.execute(owner, {
          operation: "invitations.revoke",
          operationId: randomUUID(),
          invitationId: revoked.id,
          expectedRevision: revoked.revision,
        }),
      ),
    ).toMatchObject({ state: "revoked", revision: revoked.revision + 1 });
    expect(
      failure(
        await operations.execute(owner, {
          operation: "invitations.revoke",
          operationId: randomUUID(),
          invitationId: revoked.id,
          expectedRevision: revoked.revision,
        }),
      ),
    ).toBe("revision_conflict");
    expect(await redeem(revoked.code, identityRef)).toMatchObject({
      state: "revoked",
    });
    expect(await redeem("unknown-code", identityRef)).toMatchObject({
      state: "unavailable",
    });
    now = new Date(now.getTime() + 14 * day);
    expect(await redeem(unopened.code, identityRef)).toMatchObject({
      state: "expired",
    });
    now = new Date(now.getTime() + 16 * day);
    await account(identityRef);
    expect(await redeem(opened.code, identityRef)).toMatchObject({
      state: "expired",
    });
    const expired = invitations(
      await operations.execute(owner, {
        operation: "invitations.list",
        operationId: randomUUID(),
        offerId,
        state: "expired",
      }),
    );
    expect(expired.items.map((item) => item.id).sort()).toEqual(
      [unopened.id, opened.id].sort(),
    );
  });

  test("Offer, снятый с продажи, отвечает unavailable и оставляет приглашение закреплённым", async () => {
    now = new Date("2030-01-01T00:00:00.000Z");
    const offerId = await offer({ published: false });
    const issued = invitation(await issue({ offerId, mode: "purchase" }));
    const identityRef = `telegram:${randomUUID()}`;
    await account(identityRef);
    expect(await redeem(issued.code, identityRef)).toMatchObject({
      state: "unavailable",
    });
    await db.prisma.billingOffer.update({
      where: { id: offerId },
      data: { published: true, revision: 2 },
    });
    expect(await redeem(issued.code, identityRef)).toMatchObject({
      state: "purchase_ready",
    });
  });
});
