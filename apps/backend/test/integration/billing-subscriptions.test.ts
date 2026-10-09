import { z } from "zod";
import { lockBillingSubscription } from "../../src/infrastructure/prisma/index.js";
import { eventually } from "./setup/eventually.js";
import { Client } from "@modelcontextprotocol/client";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { registerBillingTools } from "../../src/modules/billing/adapters/mcp/register-billing-tools.js";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { PurchaseSubscriptionController } from "../../src/modules/billing/features/purchase-subscription/purchase-subscription.controller.js";
import { ManageSubscriptionController } from "../../src/modules/billing/features/manage-subscription/manage-subscription.controller.js";
import { ACCESS_GRANTS } from "../../src/modules/account-rights/index.js";
import { declaredServer } from "../support/declared-api.js";
import {
  subscriptionSnapshotSchema,
  subscriptionConsentSchema,
} from "../../src/modules/billing/domain/subscription-change.js";
import {
  runRenewalJob,
  runRecoveryJob,
  runNoticeJob,
} from "../../src/entrypoints/billing-worker/jobs.js";
import {
  prepareInvitedQuote,
  seedPurchaseInvitation,
} from "./setup/purchase-invitation.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assembleAccounts,
  BillingContact,
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
  LegalAcceptances,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import {
  BillingNotices,
  BillingOperations,
  BillingPayments,
  BillingPricing,
  BillingSubscriptions,
} from "../../src/modules/billing/index.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { BankFixture } from "./setup/bank.js";
import { bindConfirmedTributeSource } from "./setup/tribute-source.js";
import { withExhaustedPool } from "./setup/exhausted-pool.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  pressedPaymentButton,
  syntheticConsentDocuments,
  type RenewalSource,
} from "./setup/consent-documents.js";
import { hasText } from "../../src/infrastructure/contracts/text.js";

function deferredValue<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const config = syntheticTbankConfig({
  environment: "demo",
  terminalKey: "SYNTHETICLIFECYCLE",
  password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 51).toString("base64"),
  recurringCardConfirmed: true,
  cardOnlyHostedConfirmed: true,
  cardBinding: { confirmed: true, checkType: "3DS" },
  minimumKopecks: 100,
  maximumKopecks: 10_000_000,
  returnUrl: "https://inside.example.test/payment/return",
  notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" },
});
const documents = syntheticConsentDocuments;
describe("подписка: продление, отмена, смена варианта и способа оплаты (реальный PostgreSQL, синтетический банк)", () => {
  let db: TestDatabase;
  let now = new Date("2030-01-31T10:00:00Z");
  let owner: string;
  let pricing: BillingPricing;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let accounts: ReturnType<typeof assembleAccounts>;
  let contact: BillingContact;
  const codes = new Map<string, string>();

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = randomUUID();
    await db.prisma.account.create({
      data: {
        id: owner,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: owner,
      },
    });
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "platform:admin" },
    });
    accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-lifecycle-fingerprint-000000",
    });
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      clock: () => now,
    });
    pricing = new BillingPricing({
      prisma: db.prisma,
      accounts,
      grants,
      clock: () => now,
      sale: { payments: true, subscriptions: true },
    });
    contact = new BillingContact({
      prisma: db.prisma,
      protection: billingContactProtection(
        Buffer.alloc(32, 52).toString("base64"),
      ),
      documents,
      now: () => now,
      sendCode: (message) => {
        codes.set(message.challengeRef, message.code);
        return Promise.resolve();
      },
    });
  });
  afterAll(async () => db.dispose());

  async function scenario(
    options: {
      readonly startedAt?: string;
      readonly priceKopecks?: number;
    } = {},
  ) {
    now = new Date(options.startedAt ?? "2030-01-31T10:00:00Z");
    // Каждый сценарий владеет своим расписанием: подписки прошлых сценариев закрываются.
    for (const stale of await db.prisma.billingSubscription.findMany({
      where: { state: { not: "ended" } },
    }))
      await db.prisma.billingSubscription.update({
        where: { id: stale.id },
        data: { state: "ended", revision: stale.revision + 1, updatedAt: now },
      });
    await db.prisma.billingPurchase.updateMany({
      where: {
        state: { in: ["prepared", "sent", "unknown", "pending", "authorized"] },
      },
      data: { state: "failed", lifecycleActive: false },
    });
    await db.prisma.billingPurchase.updateMany({
      where: { kind: "initial", lifecycleActive: true },
      data: { lifecycleActive: false },
    });
    const buyer = randomUUID();
    await db.prisma.account.create({
      data: {
        id: buyer,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: buyer,
      },
    });
    expect(
      await grants.classifyLegacy(owner, {
        operationId: randomUUID(),
        accountId: buyer,
        expectedRevision: 0,
        classification: "confirmed_new",
        sourceRef: buyer,
        reason: "Synthetic new buyer",
        bridgeEnabled: false,
        tributeStopped: false,
      }),
    ).toMatchObject({ ok: true });
    const start = await contact.start(buyer, {
      operationId: randomUUID(),
      email: `${buyer}@example.test`,
      expectedRevision: 0,
    });
    if (!start.ok) throw new Error(start.error.code);
    expect(
      await contact.confirm(buyer, {
        operationId: randomUUID(),
        challengeRef: start.challengeRef,
        code: codes.get(start.challengeRef),
      }),
    ).toMatchObject({ ok: true });
    const offerId = randomUUID(),
      optionId = randomUUID();
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "offers.save",
        value: {
          id: offerId,
          name: "Материалы",
          benefits: ["materials"],
          coverage: { productIds: [randomUUID()], materialIds: [] },
        },
      }),
    );
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "paymentOptions.save",
        value: {
          id: optionId,
          offerId,
          months: 1,
          priceKopecks: options.priceKopecks ?? 100_000,
        },
      }),
    );
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "offers.publish",
        expectedRevision: 1,
        id: offerId,
      }),
    );
    const bank = new BankFixture(config);
    const client = bank.client();
    const payments = new BillingPayments({
      prisma: db.prisma,
      bank: client,
      contact,
      grants,
      clock: () => now,
    });
    const notices = new BillingNotices({
      prisma: db.prisma,
      enrollments: grants,
      clock: () => now,
    });
    function subscriptionClient() {
      return new BillingSubscriptions({
        prisma: db.prisma,
        bank: client,
        contact,
        grants,
        payments,
        notices,
        clock: () => now,
      });
    }
    const subscriptions = subscriptionClient();

    async function consentFor(
      contextRef: string,
      renewal: RenewalSource,
      screen: "checkout" | "subscription-resume" = "checkout",
    ) {
      const accepted = await contact.acceptConsents(
        buyer,
        pressedPaymentButton(
          {
            operationId: randomUUID(),
            contextRef,
            documents: documents.map((document) => ({
              kind: document.kind,
              documentId: document.documentId,
              version: document.version,
              digest: document.digest,
              accepted: true,
            })),
          },
          renewal,
          screen,
        ),
      );
      if (!accepted.ok) throw new Error(accepted.error.code);
      return accepted.evidenceRefs;
    }
    async function buy() {
      const quote = value(
        await pricing.quote(
          buyer,
          await prepareInvitedQuote(db.prisma, buyer, {
            operationId: randomUUID(),
            paymentOptionId: optionId,
            optionRevision: 1,
          }),
        ),
      );
      const purchase = value(
        await payments.purchase(buyer, {
          operationId: randomUUID(),
          quoteRef: quote.quoteRef,
          contactRevision: 1,
          consentEvidenceRefs: await consentFor(quote.quoteRef, {
            snapshot: quote.snapshot,
          }),
          acknowledgeExistingAccess: false,
        }),
      );
      expect(
        await payments.notification(
          bank.notify(purchase.purchaseRef, "AUTHORIZED", {
            RebillId: "synthetic-first-card",
          }),
        ),
      ).toMatchObject({ ok: true });
      expect(
        await payments.notification(
          bank.notify(purchase.purchaseRef, "CONFIRMED"),
        ),
      ).toMatchObject({ ok: true });
      value(await payments.recover());
      return purchase.purchaseRef;
    }
    async function offer(
      name: string,
      benefits: readonly string[],
      months: number,
      priceKopecks: number,
    ) {
      const nextOfferId = randomUUID(),
        nextOptionId = randomUUID();
      value(
        await pricing.manage(owner, {
          operationId: randomUUID(),
          operation: "offers.save",
          value: {
            id: nextOfferId,
            name,
            benefits: [...benefits],
            coverage: { productIds: [randomUUID()], materialIds: [] },
          },
        }),
      );
      value(
        await pricing.manage(owner, {
          operationId: randomUUID(),
          operation: "paymentOptions.save",
          value: {
            id: nextOptionId,
            offerId: nextOfferId,
            months,
            priceKopecks,
          },
        }),
      );
      value(
        await pricing.manage(owner, {
          operationId: randomUUID(),
          operation: "offers.publish",
          expectedRevision: 1,
          id: nextOfferId,
        }),
      );
      await seedPurchaseInvitation(db.prisma, buyer, nextOfferId);
      return nextOptionId;
    }
    const view = async () =>
      value(await subscriptions.read(buyer)).subscription;
    return {
      buyer,
      offerId,
      optionId,
      bank,
      payments,
      subscriptions,
      subscriptionClient,
      notices,
      buy,
      offer,
      view,
      consentFor,
    };
  }

  // Isolate transport mapping from authentication; the real Billing facets own the result.
  async function httpFor(s: Awaited<ReturnType<typeof scenario>>) {
    @Module({
      controllers: [
        PurchaseSubscriptionController,
        ManageSubscriptionController,
      ],
      providers: [
        { provide: BillingPayments, useValue: s.payments },
        { provide: BillingSubscriptions, useValue: s.subscriptions },
        { provide: ACCESS_GRANTS, useValue: grants },
        {
          provide: ACCOUNTS,
          useValue: {
            resolveAccount: () =>
              Promise.resolve({ ok: true, account: { accountId: s.buyer } }),
          },
        },
        {
          provide: LOGTO_ACCESS_TOKEN_VERIFIER,
          useValue: {
            verifyAccount: () => Promise.resolve({ ok: true, identity: {} }),
          },
        },
        {
          provide: LegalAcceptances,
          useValue: {
            checkTerms: () => Promise.resolve({ ok: true, accepted: true }),
          },
        },
      ],
    })
    // oxlint-disable-next-line typescript/no-extraneous-class -- Nest requires a concrete module class for the HTTP fixture.
    class BillingHttpTestModule {}
    const app = await NestFactory.create<NestFastifyApplication>(
      BillingHttpTestModule,
      new FastifyAdapter(),
      { logger: false, abortOnError: false },
    );
    try {
      await app.init();
      const server = declaredServer(app.getHttpAdapter().getInstance());
      await server.ready();
      return { app, server };
    } catch (error) {
      await app.close();
      throw error;
    }
  }

  test("действующий владельческий MCP сохраняет dependency_unavailable при отказе Accounts", async () => {
    const s = await scenario();
    const operations = new BillingOperations({
      prisma: db.prisma,
      bank: s.bank.client(),
      accounts,
      pricing,
      payments: s.payments,
      subscriptions: s.subscriptions,
      grants,
      clock: () => now,
    });
    const mcp = new McpServer({ name: "billing-consent-test", version: "1" });
    const client = new Client({ name: "billing-consent-client", version: "1" });
    registerBillingTools(mcp, { accountId: owner, billing: operations });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([
        mcp.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      const tools = await client.listTools();
      // Buyer purchase/resume are HTTP operations, not owner MCP tools.
      expect(tools.tools.map((tool) => tool.name)).not.toContain(
        "billing_subscriptions_resume",
      );
      expect(tools.tools.map((tool) => tool.name)).not.toContain(
        "billing_purchase",
      );
      await db.prisma
        .$executeRaw`ALTER TABLE accounts.account_permissions RENAME TO unavailable_account_permissions`;
      try {
        const result = await client.callTool({
          name: "billing_payments_read",
          arguments: { operationId: randomUUID(), purchaseRef: randomUUID() },
        });
        expect(result).toMatchObject({
          isError: true,
          structuredContent: {
            ok: false,
            error: { code: "dependency_unavailable" },
          },
        });
      } finally {
        await db.prisma
          .$executeRaw`ALTER TABLE accounts.unavailable_account_permissions RENAME TO account_permissions`;
      }
    } finally {
      await client.close();
      await mcp.close();
    }
  });

  test("покупка отличает отказ чтения согласия от его отсутствия", async () => {
    const s = await scenario();
    const quote = value(
      await pricing.quote(
        s.buyer,
        await prepareInvitedQuote(db.prisma, s.buyer, {
          operationId: randomUUID(),
          paymentOptionId: s.optionId,
          optionRevision: 1,
        }),
      ),
    );
    const command = {
      operationId: randomUUID(),
      quoteRef: quote.quoteRef,
      contactRevision: 1,
      consentEvidenceRefs: await s.consentFor(quote.quoteRef, {
        snapshot: quote.snapshot,
      }),
      acknowledgeExistingAccess: false,
    };
    await db.prisma
      .$executeRaw`ALTER TABLE accounts.legal_acceptances RENAME TO unavailable_legal_acceptances`;
    try {
      expect(await s.payments.purchase(s.buyer, command)).toMatchObject({
        ok: false,
        error: { code: "dependency_unavailable" },
      });
      const { app, server } = await httpFor(s);
      try {
        const response = await server.inject({
          method: "POST",
          headers: { authorization: "Bearer synthetic-buyer" },
          url: "/accounts/current/billing/purchase",
          payload: command,
        });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({
          code: "dependency_unavailable",
        });
      } finally {
        await app.close();
      }
      expect(s.bank.initCalls).toBe(0);
    } finally {
      await db.prisma
        .$executeRaw`ALTER TABLE accounts.unavailable_legal_acceptances RENAME TO legal_acceptances`;
    }
    expect(
      await s.payments.purchase(s.buyer, {
        ...command,
        consentEvidenceRefs: [randomUUID()],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "consent_required" },
    });
    const { app, server } = await httpFor(s);
    try {
      const response = await server.inject({
        method: "POST",
        headers: { authorization: "Bearer synthetic-buyer" },
        url: "/accounts/current/billing/purchase",
        payload: { ...command, consentEvidenceRefs: [randomUUID()] },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "consent_required" });
    } finally {
      await app.close();
    }

    expect(
      await s.payments.purchase(s.buyer, {
        ...command,
        consentEvidenceRefs: await s.consentFor(randomUUID(), {
          snapshot: quote.snapshot,
        }),
      }),
    ).toMatchObject({ ok: false, error: { code: "consent_required" } });
    expect(await s.payments.purchase(s.buyer, command)).toMatchObject({
      ok: true,
    });
  });

  test("кабинет показывает собственные основания доступа и историю списаний без операторских полей", async () => {
    const s = await scenario();
    const empty = value(await s.subscriptions.read(s.buyer));
    expect(empty).toMatchObject({
      subscription: null,
      grounds: [],
      payments: [],
    });

    const purchaseRef = await s.buy();
    const cabinet = value(await s.subscriptions.read(s.buyer));
    expect(cabinet.grounds).toEqual([
      {
        source: "paid",
        capabilities: ["materials"],
        startsAt: "2030-01-31T10:00:00.000Z",
        validUntil: "2030-02-28T10:00:00.000Z",
        active: true,
      },
    ]);
    expect(cabinet.payments).toEqual([
      {
        purchaseRef,
        kind: "initial",
        state: "confirmed",
        amountKopecks: 100_000,
        offerName: "Материалы",
        months: 1,
        fiscalization: "pending",
        confirmedAt: "2030-01-31T10:00:00.000Z",
        periodEndsAt: "2030-02-28T10:00:00.000Z",
        createdAt: "2030-01-31T10:00:00.000Z",
        refundedKopecks: 0,
        refundedAt: null,
      },
    ]);
    // Данные провайдера и операторские поля остаются владельческими.
    const [payment] = cabinet.payments;
    expect(payment).not.toHaveProperty("terminalRef");
    expect(payment).not.toHaveProperty("environment");
    expect(payment).not.toHaveProperty("paymentId");
    const [ground] = cabinet.grounds;
    expect(ground).not.toHaveProperty("reason");
    expect(ground).not.toHaveProperty("sourceRef");
    expect(ground).not.toHaveProperty("grantRef");
  });

  test("отозванное основание пропадает из кабинета, а независимое остаётся", async () => {
    const s = await scenario();
    await s.buy();
    const row = {
      rowKey: "row-1",
      accountId: s.buyer,
      source: "manual" as const,
      sourceRef: randomUUID(),
      terms: {
        capabilities: ["support" as const],
        startsAt: "2030-01-01T00:00:00.000Z",
        validUntil: null,
        reason: "Ручная выдача для проверки",
      },
    };
    const preview = await grants.previewBatch(owner, {
      operationId: randomUUID(),
      rows: [row],
    });
    if (!preview.ok) throw new Error(preview.error.code);
    const applied = await grants.applyBatch(owner, {
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: preview.revision,
      confirmedRows: ["row-1"],
    });
    if (!applied.ok) throw new Error(applied.error.code);
    const withManual = value(await s.subscriptions.read(s.buyer));
    expect(withManual.grounds.map((ground) => ground.source).sort()).toEqual([
      "manual",
      "paid",
    ]);

    // Оплаченное основание отзывается только подтверждённым возвратом, поэтому владелец
    // отзывает ручное: независимость оснований видна в допустимом направлении.
    const paid = await db.prisma.accessGrant.findFirstOrThrow({
      where: { accountId: s.buyer, source: "paid" },
    });
    expect(
      await grants.changeGrant(owner, {
        operationId: randomUUID(),
        action: "revoke",
        grantRef: paid.id,
        expectedRevision: paid.revision,
        reason: "Проверка отзыва",
      }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });

    const manual = await db.prisma.accessGrant.findFirstOrThrow({
      where: { accountId: s.buyer, source: "manual" },
    });
    const revoked = await grants.changeGrant(owner, {
      operationId: randomUUID(),
      action: "revoke",
      grantRef: manual.id,
      expectedRevision: manual.revision,
      reason: "Проверка отзыва",
    });
    if (!revoked.ok) throw new Error(revoked.error.code);
    expect(value(await s.subscriptions.read(s.buyer)).grounds).toEqual([
      {
        source: "paid",
        capabilities: ["materials"],
        startsAt: "2030-01-31T10:00:00.000Z",
        validUntil: "2030-02-28T10:00:00.000Z",
        active: true,
      },
    ]);
  });

  test("продление считает срок от исходного anchor и продолжает права без перерыва", async () => {
    const s = await scenario();
    await s.buy();
    expect(await s.view()).toMatchObject({
      state: "active",
      paidUntil: "2030-02-28T10:00:00.000Z",
      periodIndex: 1,
    });
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({
      inspected: 1,
      started: 1,
      blocked: 0,
    });
    expect(await s.view()).toMatchObject({
      state: "active",
      periodIndex: 2,
      periodStartsAt: "2030-02-28T10:00:00.000Z",
      paidUntil: "2030-03-31T10:00:00.000Z",
    });
    expect(s.bank.chargeCalls).toBe(1);
    value(await s.payments.recover());
    const saved = await db.prisma.accessGrant.findMany({
      where: { accountId: s.buyer },
      orderBy: { startsAt: "asc" },
    });
    expect(saved).toHaveLength(2);
    expect(saved[1]?.startsAt.toISOString()).toBe("2030-02-28T10:00:00.000Z");
    expect(saved[1]?.validUntil?.toISOString()).toBe(
      "2030-03-31T10:00:00.000Z",
    );
    // Повторный проход не создаёт вторую попытку того же периода.
    expect(value(await s.payments.renew())).toMatchObject({ started: 0 });
    expect(s.bank.chargeCalls).toBe(1);
  });

  test("без терминала продление сообщает простой по настройке и сохраняет рабочую привязку", async () => {
    const s = await scenario();
    await s.buy();
    const withoutBank = new BillingPayments({
      prisma: db.prisma,
      bank: undefined,
      contact,
      grants,
      clock: () => now,
    });
    expect(value(await withoutBank.renew())).toMatchObject({
      inspected: 0,
      started: 0,
      blocked: 0,
      closed: 0,
    });
    now = new Date("2030-02-28T10:00:00Z");
    expect(await withoutBank.renew()).toMatchObject({
      ok: true,
      value: {
        status: "configuration_idle",
        terminal: "no_terminal",
        started: 0,
      },
    });
    expect(await s.view()).toMatchObject({ state: "active", periodIndex: 1 });
    // Простой не создаёт попытки оплаты и не обращается к банку.
    expect(
      await db.prisma.billingPurchase.count({
        where: { accountId: s.buyer, kind: "renewal" },
      }),
    ).toBe(0);
    expect(s.bank.chargeCalls).toBe(0);
    // Подписка, которую продлить нечем, закрывается, и проход завершается штатно.
    const due = await db.prisma.billingSubscription.findFirstOrThrow({
      where: { accountId: s.buyer, state: "active" },
    });
    await db.prisma.billingSubscription.update({
      where: { id: due.id },
      data: {
        bindingRevokedAt: now,
        revision: due.revision + 1,
        updatedAt: now,
      },
    });
    expect(value(await withoutBank.renew())).toMatchObject({
      started: 0,
      closed: 1,
    });
    expect(await s.view()).toBeNull();
  });

  test("без терминала отменённая подписка закрывается по истечении срока", async () => {
    const s = await scenario();
    await s.buy();
    const withoutBank = new BillingPayments({
      prisma: db.prisma,
      bank: undefined,
      contact,
      grants,
      clock: () => now,
    });
    const subscriptions = new BillingSubscriptions({
      prisma: db.prisma,
      bank: undefined,
      contact,
      grants,
      payments: withoutBank,
      notices: s.notices,
      clock: () => now,
    });
    // Закрыть истёкший срок отменённой подписки можно и без банка.
    const active = await s.view();
    value(
      await s.subscriptions.cancel(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
      }),
    );
    now = new Date("2030-02-28T10:00:00Z");
    expect(await runRenewalJob(withoutBank, subscriptions)).toMatchObject({
      status: "configuration_idle",
      terminal: "no_terminal",
      inspected: 0,
      started: 0,
      blocked: 0,
      closed: 1,
      bindings: { status: "configuration_idle", inspected: 0, applied: 0 },
    });
    const operations = new BillingOperations({
      prisma: db.prisma,
      bank: undefined,
      accounts,
      pricing,
      payments: withoutBank,
      subscriptions,
      grants,
      clock: () => now,
    });
    expect(await runRecoveryJob(withoutBank, operations)).toEqual({
      status: "configuration_idle",
      inspected: 0,
      applied: 0,
      failed: 0,
      refunds: {
        status: "configuration_idle",
        inspected: 0,
        settled: 0,
        failed: 0,
      },
    });
    expect(await s.view()).toBeNull();
  });

  test.each([false, true])(
    "первые 20 активных расписаний не задерживают закрытие отменённого срока (терминал: %s)",
    async (withBank) => {
      const s = await scenario();
      await s.buy();
      const active = await s.view();
      value(
        await s.subscriptions.cancel(s.buyer, {
          operationId: randomUUID(),
          expectedRevision: active?.revision,
        }),
      );
      const source = await db.prisma.billingSubscription.findFirstOrThrow({
        where: { accountId: s.buyer },
      });
      for (let index = 0; index < 20; index += 1) {
        const accountId = randomUUID();
        await db.prisma.account.create({
          data: {
            id: accountId,
            logtoIssuer: "https://identity.example.test",
            logtoSubject: accountId,
          },
        });
        // Исторические расписания раньше отменённого срока; контакт ещё не подтверждён.
        await db.prisma.billingSubscription.create({
          data: {
            ...source,
            snapshot: subscriptionSnapshotSchema.parse(source.snapshot),
            consent: subscriptionConsentSchema.parse(source.consent),
            pendingChange: {},
            id: randomUUID(),
            accountId,
            state: "active",
            revision: 1,
            paidUntil: new Date("2030-02-27T10:00:00Z"),
          },
        });
      }
      now = new Date("2030-02-28T10:00:00Z");
      const payments = withBank
        ? s.payments
        : new BillingPayments({
            prisma: db.prisma,
            bank: undefined,
            contact,
            grants,
            clock: () => now,
          });
      expect(value(await payments.renew(20))).toMatchObject({
        inspected: 20,
        started: 0,
        closed: 1,
      });
      expect(await s.view()).toBeNull();
      expect(s.bank.chargeCalls).toBe(0);
    },
  );

  test("терминал без recurring сообщает простой и не закрывает принятое расписание", async () => {
    const s = await scenario();
    await s.buy();
    const bank = new BankFixture({ ...config, recurringCardConfirmed: false });
    const payments = new BillingPayments({
      prisma: db.prisma,
      bank: bank.client(),
      contact,
      grants,
      clock: () => now,
    });
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await payments.renew())).toMatchObject({
      status: "configuration_idle",
      terminal: "no_recurring",
      inspected: 1,
      started: 0,
      closed: 0,
    });
    expect(await s.view()).toMatchObject({ state: "active", periodIndex: 1 });
    expect(bank.initCalls).toBe(0);
  });

  test.each(["usable", "missing", "revoked"])(
    "напоминание и списание согласованы при привязке %s",
    async (binding) => {
      const s = await scenario();
      await s.buy();
      const row = await db.prisma.billingSubscription.findFirstOrThrow({
        where: { accountId: s.buyer },
      });
      await db.prisma.billingSubscription.update({
        where: { id: row.id },
        data: {
          bindingRef: binding === "missing" ? null : row.bindingRef,
          bindingCiphertext:
            binding === "missing" ? null : row.bindingCiphertext,
          bindingRevokedAt: binding === "revoked" ? now : null,
          revision: row.revision + 1,
          updatedAt: now,
        },
      });
      now = new Date("2030-02-25T10:00:00Z");
      await runNoticeJob(s.notices);
      const reminders = (await s.notices.readNotices(s.buyer)).filter(
        (notice) =>
          notice.kind === "renewal_reminder" && notice.state === "current",
      );
      expect(reminders).toHaveLength(binding === "usable" ? 1 : 0);
      now = new Date("2030-02-28T10:00:00Z");
      expect(await runRenewalJob(s.payments, s.subscriptions)).toMatchObject({
        status: "ready",
        terminal: "ready",
        started: binding === "usable" ? 1 : 0,
        closed: binding === "usable" ? 0 : 1,
      });
      expect(s.bank.chargeCalls).toBe(binding === "usable" ? 1 : 0);
      if (binding === "usable")
        expect(await s.view()).toMatchObject({ periodIndex: 2 });
      else expect(await s.view()).toBeNull();
    },
  );

  test("отмена до отправки запрещает вызов банка и сохраняет оплаченный срок", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const canceled = value(
      await s.subscriptions.cancel(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
      }),
    );
    expect(canceled).toMatchObject({
      state: "canceled",
      paidUntil: "2030-02-28T10:00:00.000Z",
      inFlightPayment: null,
    });
    const initBefore = s.bank.initCalls;
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({
      inspected: 0,
      started: 0,
      closed: 1,
    });
    expect(s.bank.initCalls).toBe(initBefore);
    expect(s.bank.chargeCalls).toBe(0);
    expect(await s.view()).toBeNull();
    // Освободившееся место позволяет вернуться новой покупкой, а не воскрешением прежней.
    now = new Date("2030-04-05T09:00:00Z");
    await s.buy();
    expect(await s.view()).toMatchObject({
      state: "active",
      periodIndex: 1,
      paidUntil: "2030-05-05T09:00:00.000Z",
    });
  });

  test("отмена после отправки сверяет прежнюю попытку: поздний успех даёт период без новых списаний", async () => {
    const s = await scenario();
    await s.buy();
    now = new Date("2030-02-28T10:00:00Z");
    s.bank.failCharge = true;
    value(await s.payments.renew());
    const pending = await s.view();
    expect(pending?.inFlightPayment).toMatchObject({
      kind: "renewal",
      state: "unknown",
    });
    const canceled = value(
      await s.subscriptions.cancel(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: pending?.revision,
      }),
    );
    expect(canceled.state).toBe("canceled");
    expect(canceled.inFlightPayment).not.toBeNull();
    s.bank.failCharge = false;
    const attemptRef = pending?.inFlightPayment?.attemptRef;
    if (!hasText(attemptRef))
      throw new Error("Missing synthetic renewal attempt");
    s.bank.settle(attemptRef, "CONFIRMED");
    expect(await s.payments.reconcile(attemptRef)).toMatchObject({ ok: true });
    expect(await s.view()).toMatchObject({
      state: "canceled",
      periodIndex: 2,
      paidUntil: "2030-03-31T10:00:00.000Z",
      inFlightPayment: null,
    });
    // Сверка не повторяет Charge и не запускает следующее списание.
    expect(s.bank.chargeCalls).toBe(1);
    now = new Date("2030-03-31T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({
      inspected: 0,
      started: 0,
    });
    expect(s.bank.chargeCalls).toBe(1);
  });

  test("Offer для прежних подписчиков Tribute не выбирается сменой варианта и не покупается по расчёту, пережившему основание", async () => {
    const s = await scenario();
    await s.buy();
    const restrictedOffer = randomUUID(),
      restrictedOption = randomUUID();
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "offers.save",
        value: {
          id: restrictedOffer,
          name: "Продление подписки Tribute",
          benefits: ["materials", "support"],
          coverage: { productIds: [randomUUID()], materialIds: [] },
          eligibility: "former_tribute_subscribers",
        },
      }),
    );
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "paymentOptions.save",
        value: {
          id: restrictedOption,
          offerId: restrictedOffer,
          months: 2,
          priceKopecks: 180_000,
        },
      }),
    );
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "offers.publish",
        expectedRevision: 1,
        id: restrictedOffer,
      }),
    );
    // Смена варианта — та же покупка Offer: без основания она отклоняется до расчёта доплаты.
    // Основания читаются до транзакции смены: на пуле из одного соединения она не ждёт сама себя.
    const active = await s.view();
    await withExhaustedPool(db, async (pool) => {
      const subscriptions = new BillingSubscriptions({
        prisma: pool,
        bank: s.bank.client(),
        contact,
        grants: assembleAccessGrants({
          prisma: pool,
          accounts,
          clock: () => now,
        }),
        payments: s.payments,
        notices: new BillingNotices({
          prisma: pool,
          enrollments: grants,
          clock: () => now,
        }),
        clock: () => now,
      });
      expect(
        await subscriptions.quoteChange(s.buyer, {
          operationId: randomUUID(),
          expectedRevision: active?.revision,
          paymentOptionId: restrictedOption,
        }),
      ).toEqual({ ok: false, error: { code: "not_eligible" } });
      // Подтверждённый период Tribute и приглашение допускают к смене на этот вариант.
      await bindConfirmedTributeSource(db.prisma, s.buyer);
      await seedPurchaseInvitation(db.prisma, s.buyer, restrictedOffer);
      const quoted = value(
        await subscriptions.quoteChange(s.buyer, {
          operationId: randomUUID(),
          expectedRevision: active?.revision,
          paymentOptionId: restrictedOption,
        }),
      );
      expect(quoted.plan).toMatchObject({ kind: "scheduled" });
      expect(
        await subscriptions.change(s.buyer, {
          operationId: randomUUID(),
          expectedRevision: active?.revision,
          changeQuoteRef: quoted.changeQuoteRef,
        }),
      ).toMatchObject({ ok: true });
    });

    // Расчёт, сохранённый при действующем основании, после его отзыва не покупает Offer.
    const other = await scenario();
    const source = await bindConfirmedTributeSource(db.prisma, other.buyer);
    const quote = value(
      await pricing.quote(
        other.buyer,
        await prepareInvitedQuote(db.prisma, other.buyer, {
          operationId: randomUUID(),
          paymentOptionId: restrictedOption,
          optionRevision: 1,
        }),
      ),
    );
    await source.revoke();
    expect(
      await other.payments.purchase(other.buyer, {
        operationId: randomUUID(),
        quoteRef: quote.quoteRef,
        contactRevision: 1,
        consentEvidenceRefs: await other.consentFor(quote.quoteRef, {
          snapshot: quote.snapshot,
        }),
        acknowledgeExistingAccess: true,
      }),
    ).toEqual({ ok: false, error: { code: "not_eligible" } });
    // Отказ не держит резерв цены: покупки не было.
    expect(
      await db.prisma.billingPurchase.count({
        where: { accountId: other.buyer, state: { not: "failed" } },
      }),
    ).toBe(0);
  });

  test("повышение доплачивает остаток срока, а понижение и другая длительность ждут следующего периода", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const higher = await s.offer(
      "Материалы и сопровождение",
      ["materials", "support"],
      1,
      350_000,
    );
    now = new Date("2030-01-16T12:00:00Z");
    const active = await s.view();
    const quoted = value(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        paymentOptionId: higher,
      }),
    );
    expect(quoted.plan).toMatchObject({
      kind: "upgrade",
      topUpKopecks: 125_000,
    });
    const applied = value(
      await s.subscriptions.change(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        changeQuoteRef: quoted.changeQuoteRef,
      }),
    );
    const attemptRef = applied.payment?.purchaseRef;
    if (!hasText(attemptRef))
      throw new Error("Upgrade payment attempt is missing");
    expect(
      await db.prisma.billingPurchase.findUniqueOrThrow({
        where: { id: attemptRef },
      }),
    ).toMatchObject({ kind: "upgrade", amountKopecks: 125_000n });
    expect(
      await s.payments.notification(s.bank.notify(attemptRef, "CONFIRMED")),
    ).toMatchObject({ ok: true });
    const upgraded = await s.view();
    expect(upgraded).toMatchObject({
      paidUntil: "2030-02-01T00:00:00.000Z",
      periodAmountKopecks: 350_000,
    });
    expect(upgraded?.snapshot.offer.benefits).toEqual(["materials", "support"]);
    value(await s.payments.recover());
    expect(
      await db.prisma.accessGrant.count({
        where: { accountId: s.buyer, capabilities: { has: "support" } },
      }),
    ).toBe(1);
    const yearly = await s.offer(
      "Материалы на год",
      ["materials"],
      12,
      900_000,
    );
    const scheduled = value(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: upgraded?.revision,
        paymentOptionId: yearly,
      }),
    );
    expect(scheduled.plan).toMatchObject({
      kind: "scheduled",
      effectiveAt: "2030-02-01T00:00:00.000Z",
    });
    const pending = value(
      await s.subscriptions.change(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: upgraded?.revision,
        changeQuoteRef: scheduled.changeQuoteRef,
      }),
    );
    expect(pending.payment).toBeNull();
    expect(
      pending.subscription.pendingChange?.snapshot.paymentOption.months,
    ).toBe(12);
    const dropped = value(
      await s.subscriptions.cancelChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: pending.subscription.revision,
      }),
    );
    expect(dropped.pendingChange).toBeNull();
  });

  test("принятая доплата не пересчитывается временем, а изменившиеся условия отклоняются", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const higher = await s.offer(
      "Материалы и сопровождение",
      ["materials", "support"],
      1,
      350_000,
    );
    now = new Date("2030-01-16T12:00:00Z");
    const active = await s.view();
    const quoted = value(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        paymentOptionId: higher,
      }),
    );
    expect(quoted.plan).toMatchObject({
      kind: "upgrade",
      topUpKopecks: 125_000,
    });
    now = new Date("2030-01-16T12:10:00Z");
    const applied = value(
      await s.subscriptions.change(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        changeQuoteRef: quoted.changeQuoteRef,
      }),
    );
    const attemptRef = applied.payment?.purchaseRef;
    if (!hasText(attemptRef))
      throw new Error("Upgrade payment attempt is missing");
    expect(
      (
        await db.prisma.billingPurchase.findUniqueOrThrow({
          where: { id: attemptRef },
        })
      ).amountKopecks,
    ).toBe(125_000n);

    const other = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await other.buy();
    const target = await other.offer(
      "Материалы и сопровождение",
      ["materials", "support"],
      1,
      350_000,
    );
    now = new Date("2030-01-16T12:00:00Z");
    const before = await other.view();
    const stale = value(
      await other.subscriptions.quoteChange(other.buyer, {
        operationId: randomUUID(),
        expectedRevision: before?.revision,
        paymentOptionId: target,
      }),
    );
    value(
      await pricing.manage(owner, {
        operationId: randomUUID(),
        operation: "paymentOptions.save",
        expectedRevision: 1,
        value: {
          id: target,
          offerId: stale.plan.snapshot.offer.id,
          months: 1,
          priceKopecks: 400_000,
        },
      }),
    );
    expect(
      await other.subscriptions.change(other.buyer, {
        operationId: randomUUID(),
        expectedRevision: before?.revision,
        changeQuoteRef: stale.changeQuoteRef,
      }),
    ).toMatchObject({ error: { code: "quote_changed" } });
  });

  test("второе повышение считается от цены действующего варианта, а не от первой оплаты", async () => {
    const s = await scenario({
      startedAt: "2030-01-01T00:00:00Z",
      priceKopecks: 100_000,
    });
    await s.buy();
    const higher = await s.offer(
      "Материалы и сопровождение",
      ["materials", "support"],
      1,
      350_000,
    );
    now = new Date("2030-01-16T12:00:00Z");
    const active = await s.view();
    const first = value(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        paymentOptionId: higher,
      }),
    );
    const applied = value(
      await s.subscriptions.change(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        changeQuoteRef: first.changeQuoteRef,
      }),
    );
    const attemptRef = applied.payment?.purchaseRef;
    if (!hasText(attemptRef))
      throw new Error("Upgrade payment attempt is missing");
    expect(
      await s.payments.notification(s.bank.notify(attemptRef, "CONFIRMED")),
    ).toMatchObject({ ok: true });
    const upgraded = await s.view();
    expect(upgraded?.periodAmountKopecks).toBe(350_000);
    // Три четверти месяца позади: остаток при переходе 3 500 ₽ → 5 000 ₽ стоит 375 ₽.
    const top = await s.offer(
      "Материалы, сопровождение и разбор",
      ["materials", "support", "community"],
      1,
      500_000,
    );
    now = new Date("2030-01-24T06:00:00Z");
    const second = value(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: upgraded?.revision,
        paymentOptionId: top,
      }),
    );
    expect(second.plan).toMatchObject({
      kind: "upgrade",
      topUpKopecks: 37_500,
    });
  });

  test("повышение доступно внутри отменённого оплаченного срока, а запланированное изменение — нет", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const higher = await s.offer(
      "Материалы и сопровождение",
      ["materials", "support"],
      1,
      350_000,
    );
    const cheaper = await s.offer(
      "Материалы, короткий доступ",
      ["materials"],
      1,
      70_000,
    );
    now = new Date("2030-01-16T12:00:00Z");
    const active = await s.view();
    const canceled = value(
      await s.subscriptions.cancel(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
      }),
    );
    expect(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: canceled.revision,
        paymentOptionId: cheaper,
      }),
    ).toMatchObject({ error: { code: "revision_conflict" } });
    const quoted = value(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: canceled.revision,
        paymentOptionId: higher,
      }),
    );
    const applied = value(
      await s.subscriptions.change(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: canceled.revision,
        changeQuoteRef: quoted.changeQuoteRef,
      }),
    );
    const attemptRef = applied.payment?.purchaseRef;
    if (!hasText(attemptRef))
      throw new Error("Upgrade payment attempt is missing");
    expect(
      await s.payments.notification(s.bank.notify(attemptRef, "CONFIRMED")),
    ).toMatchObject({ ok: true });
    const upgraded = await s.view();
    expect(upgraded).toMatchObject({
      state: "canceled",
      periodAmountKopecks: 350_000,
      paidUntil: "2030-02-01T00:00:00.000Z",
    });
  });

  test("потерянный ответ Init завершает ту же попытку через CheckOrder и GetState", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    now = new Date("2030-02-01T00:00:00Z");
    s.bank.failInit = true;
    await expect(runRenewalJob(s.payments, s.subscriptions)).rejects.toThrow(
      "provider_unavailable",
    );
    const pending = await s.view();
    const attemptRef = pending?.inFlightPayment?.attemptRef;
    if (!hasText(attemptRef))
      throw new Error("Missing synthetic renewal attempt");
    expect(pending?.inFlightPayment).toMatchObject({
      kind: "renewal",
      state: "unknown",
    });
    expect(
      (
        await db.prisma.billingPurchase.findUniqueOrThrow({
          where: { id: attemptRef },
        })
      ).chargeCalled,
    ).toBe(false);
    expect(s.bank.chargeCalls).toBe(0);
    s.bank.failInit = false;
    s.bank.failState = true;
    const operations = new BillingOperations({
      prisma: db.prisma,
      bank: s.bank.client(),
      accounts,
      pricing,
      payments: s.payments,
      subscriptions: s.subscriptions,
      grants,
      clock: () => now,
    });
    await expect(runRecoveryJob(s.payments, operations)).rejects.toThrow(
      "provider_unavailable",
    );
    expect((await s.view())?.inFlightPayment?.state).toBe("unknown");
    expect(s.bank.chargeCalls).toBe(0);
    s.bank.failState = false;
    expect(await s.payments.reconcile(attemptRef)).toMatchObject({ ok: true });
    expect(s.bank.initCalls).toBe(2);
    expect(s.bank.chargeCalls).toBe(1);
    expect(await s.view()).toMatchObject({
      state: "active",
      periodIndex: 2,
      paidUntil: "2030-03-01T00:00:00.000Z",
    });
  });

  test("конкурентная сверка NEW не вызывает второго Charge и не сообщает ложный сбой", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    now = new Date("2030-02-01T00:00:00Z");
    s.bank.failInit = true;
    value(await s.payments.renew());
    const attemptRef = (await s.view())?.inFlightPayment?.attemptRef;
    if (!hasText(attemptRef))
      throw new Error("Missing synthetic renewal attempt");
    s.bank.failInit = false;
    // Оба вызова получают доказанный NEW до начала любого Charge.
    s.bank.gateStateResponses(2);
    const results = await Promise.all([
      s.payments.reconcile(attemptRef),
      s.payments.reconcile(attemptRef),
    ]);
    expect(results).toEqual([
      { ok: true, value: true },
      { ok: true, value: true },
    ]);
    expect(s.bank.chargeCalls).toBe(1);
    expect((await s.view())?.periodIndex).toBe(2);
  });

  test.each(["classification", "contact", "consent"])(
    "ошибка PostgreSQL при чтении %s завершает задание сбоем",
    async (source) => {
      const s = await scenario();
      await s.buy();
      now = new Date("2030-02-28T10:00:00Z");
      // Отказ настоящей базы в отдельном test database, без замены фасетов.
      if (source === "classification")
        await db.prisma
          .$executeRaw`ALTER TABLE account_rights.legacy_classifications RENAME TO unavailable_legacy_classifications`;
      else if (source === "contact")
        await db.prisma
          .$executeRaw`ALTER TABLE accounts.billing_contacts RENAME TO unavailable_billing_contacts`;
      else
        await db.prisma
          .$executeRaw`ALTER TABLE accounts.legal_acceptances RENAME TO unavailable_legal_acceptances`;
      try {
        await expect(
          runRenewalJob(s.payments, s.subscriptions),
        ).rejects.toThrow("provider_unavailable");
        expect(s.bank.chargeCalls).toBe(0);
      } finally {
        if (source === "classification")
          await db.prisma
            .$executeRaw`ALTER TABLE account_rights.unavailable_legacy_classifications RENAME TO legacy_classifications`;
        else if (source === "contact")
          await db.prisma
            .$executeRaw`ALTER TABLE accounts.unavailable_billing_contacts RENAME TO billing_contacts`;
        else
          await db.prisma
            .$executeRaw`ALTER TABLE accounts.unavailable_legal_acceptances RENAME TO legal_acceptances`;
      }
      expect((await s.view())?.state).toBe("active");
    },
  );

  test.each(["prepared", "unknown"])(
    "восстановление %s продления без recurring не отправляет Init или Charge",
    async (state) => {
      const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
      await s.buy();
      now = new Date("2030-02-01T00:00:00Z");
      s.bank.failInit = true;
      value(await s.payments.renew());
      const attemptRef = (await s.view())?.inFlightPayment?.attemptRef;
      if (!hasText(attemptRef))
        throw new Error("Missing synthetic renewal attempt");
      await db.prisma.billingPurchase.update({
        where: { id: attemptRef },
        data: { state },
      });
      // Смена конфигурации процесса сохраняет тот же банк и уже принятое им NEW.
      const unreadyBank = s.bank.client({
        ...config,
        recurringCardConfirmed: false,
      });
      const payments = new BillingPayments({
        prisma: db.prisma,
        bank: unreadyBank,
        contact,
        grants,
        clock: () => now,
      });
      const initCalls = s.bank.initCalls;
      expect(value(await payments.recover())).toMatchObject({
        status: "configuration_idle",
        failed: 0,
      });
      expect(s.bank.initCalls).toBe(initCalls);
      expect(s.bank.chargeCalls).toBe(0);
      expect((await s.view())?.inFlightPayment?.state).toBe(
        state === "prepared" ? "prepared" : "pending",
      );
      s.bank.failInit = false;
      expect(await s.payments.reconcile(attemptRef)).toMatchObject({
        ok: true,
      });
      expect((await s.view())?.periodIndex).toBe(2);
    },
  );

  test("отправленное продление не даёт согласовать другое изменение того же периода", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const cheaper = await s.offer(
      "Материалы, короткий доступ",
      ["materials"],
      1,
      70_000,
    );
    now = new Date("2030-02-01T00:00:00Z");
    s.bank.failCharge = true;
    value(await s.payments.renew());
    const pending = await s.view();
    expect(pending?.inFlightPayment).toMatchObject({
      kind: "renewal",
      state: "unknown",
    });
    const quoted = value(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: pending?.revision,
        paymentOptionId: cheaper,
      }),
    );
    expect(
      await s.subscriptions.change(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: pending?.revision,
        changeQuoteRef: quoted.changeQuoteRef,
      }),
    ).toMatchObject({ error: { code: "payment_in_progress" } });
  });

  test("согласованное изменение применяется следующим периодом по сохранённым условиям", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const cheaper = await s.offer(
      "Материалы, короткий доступ",
      ["materials"],
      1,
      70_000,
    );
    const active = await s.view();
    const quoted = value(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        paymentOptionId: cheaper,
      }),
    );
    expect(quoted.plan.kind).toBe("scheduled");
    value(
      await s.subscriptions.change(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        changeQuoteRef: quoted.changeQuoteRef,
      }),
    );
    now = new Date("2030-02-01T00:00:00Z");
    value(await s.payments.renew());
    const renewed = await s.view();
    expect(renewed).toMatchObject({
      periodIndex: 2,
      periodAmountKopecks: 70_000,
      pendingChange: null,
    });
    expect(renewed?.snapshot.paymentOption.priceKopecks).toBe(70_000);
  });

  test("однозначный отказ завершает расписание без повторов и grace, ручное возвращение даёт новый период", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    now = new Date("2030-02-01T00:00:00Z");
    s.bank.chargeOutcome = "REJECTED";
    value(await s.payments.renew());
    expect(await s.view()).toBeNull();
    expect(s.bank.chargeCalls).toBe(1);
    expect(value(await s.payments.renew())).toMatchObject({
      inspected: 0,
      started: 0,
    });
    now = new Date("2030-03-10T08:30:00Z");
    s.bank.chargeOutcome = "CONFIRMED";
    await s.buy();
    expect(await s.view()).toMatchObject({
      state: "active",
      periodIndex: 1,
      periodStartsAt: "2030-03-10T08:30:00.000Z",
      paidUntil: "2030-04-10T08:30:00.000Z",
    });
  });

  test.each(["revision", "ended", "ended_matching_revision"] as const)(
    "смена карты после ожидания блокировки учитывает %s подписки без попытки и AddCard",
    async (change) => {
      const s = await scenario();
      await s.buy();
      const active = await s.view();
      if (!active) throw new Error("Missing synthetic subscription");
      const locked = deferredValue<number>();
      const proceed = deferredValue<boolean>();
      const ownerChange = db.run(() =>
        db.prisma.$transaction(async (tx) => {
          await lockBillingSubscription(tx, active.subscriptionRef);
          const [backend] = z
            .array(z.object({ pid: z.int().positive() }))
            .parse(await tx.$queryRaw`SELECT pg_backend_pid() AS pid`);
          if (!backend) throw new Error("Missing transaction PID");
          locked.resolve(backend.pid);
          await proceed.promise;
          await tx.billingSubscription.update({
            where: { id: active.subscriptionRef },
            data: {
              ...(change === "revision" ? {} : { state: "ended" as const }),
              revision: active.revision + 1,
              updatedAt: now,
            },
          });
        }),
      );
      const ownerPid = await locked.promise;
      const changing = db.run(() =>
        s.subscriptions.changeMethod(s.buyer, {
          operationId: randomUUID(),
          // A matching revision must not authorize an ended subscription either.
          expectedRevision:
            change === "ended_matching_revision"
              ? active.revision + 1
              : active.revision,
        }),
      );
      const results = Promise.allSettled([ownerChange, changing]);
      try {
        await eventually(async () => {
          const rows = z.array(z.object({ waiting: z.boolean() })).parse(
            await db.prisma.$queryRaw`SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%pg_advisory_xact_lock%'
              AND ${ownerPid} = ANY(pg_blocking_pids(pid))
            ) AS waiting`,
          );
          expect(rows[0]?.waiting).toBe(true);
        }, 2_000);
      } finally {
        proceed.resolve(true);
        await results;
      }
      await ownerChange;
      expect(await changing).toMatchObject({
        ok: false,
        error: {
          code: change === "revision" ? "revision_conflict" : "not_found",
        },
      });
      expect(s.bank.addCardCalls).toBe(0);
      expect(
        await db.prisma.billingPaymentMethodFlow.count({
          where: { accountId: s.buyer },
        }),
      ).toBe(0);
      const current = await s.view();
      if (change === "revision") {
        expect(current?.revision).toBe(active.revision + 1);
        expect(current?.pendingMethodChange).toBeNull();
      } else expect(current).toBeNull();
    },
  );

  test("активный AddCard старше 10 секунд переживает worker и поздний ответ даёт рабочую форму", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const gate = s.bank.holdAddCardResponse();
    const command = {
      operationId: randomUUID(),
      expectedRevision: active?.revision,
    };
    const changing = db.run(() =>
      s.subscriptions.changeMethod(s.buyer, command),
    );
    const settled = Promise.allSettled([changing]);
    const worker = s.subscriptionClient();
    try {
      await gate.entered;
      now = new Date("2030-01-31T10:00:11Z");
      expect(value(await worker.reconcileMethodFlows())).toMatchObject({
        inspected: 1,
        applied: 0,
      });
      expect((await s.view())?.pendingMethodChange).toMatchObject({
        formUrl: null,
      });
      expect(value(await worker.changeMethod(s.buyer, command))).toMatchObject({
        state: "started",
        formUrl: null,
      });
    } finally {
      gate.release();
      await settled;
    }
    const started = value(await changing);
    expect(started).toMatchObject({
      state: "started",
      formUrl: "https://securepay.tinkoff.ru/binding",
    });
    expect(value(await s.subscriptions.changeMethod(s.buyer, command))).toEqual(
      started,
    );
    expect(value(await worker.reconcileMethodFlows())).toMatchObject({
      applied: 1,
    });
    expect(await s.view()).toMatchObject({
      paymentMethod: { methodRef: started.flowRef },
      pendingMethodChange: null,
    });
    expect(s.bank.addCardCalls).toBe(1);
  });

  test("потеря PostgreSQL-владельца восстанавливает попытку ровно с 10 секунд и поздний ответ не оживляет её", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const gate = s.bank.holdAddCardResponse();
    const command = {
      operationId: randomUUID(),
      expectedRevision: active?.revision,
    };
    const changing = db.run(() =>
      s.subscriptions.changeMethod(s.buyer, command),
    );
    const settled = Promise.allSettled([changing]);
    const worker = s.subscriptionClient();
    try {
      await gate.entered;
      // A dedicated database proves which live transaction owns this attempt. Terminating that
      // backend models the lease loss left by a lost Platform process, while retaining a late bank reply.
      const [owner] = z
        .array(z.strictObject({ pid: z.int().positive() }))
        .length(1)
        .parse(
          await db.prisma.$queryRaw`SELECT a.pid FROM pg_stat_activity a
          WHERE a.datname = current_database() AND EXISTS (
            SELECT 1 FROM pg_locks l WHERE l.pid = a.pid AND l.locktype = 'advisory'
              AND l.granted AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
          )`,
        );
      if (!owner) throw new Error("Missing AddCard lease owner");
      const terminated = z
        .array(z.strictObject({ terminated: z.boolean() }))
        .length(1)
        .parse(
          await db.prisma
            .$queryRaw`SELECT pg_terminate_backend(${owner.pid}) AS terminated`,
        );
      expect(terminated[0]?.terminated).toBe(true);
      await eventually(async () => {
        const rows = z
          .array(z.strictObject({ present: z.boolean() }))
          .length(1)
          .parse(
            await db.prisma
              .$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = ${owner.pid}) AS present`,
          );
        expect(rows[0]?.present).toBe(false);
      }, 2_000);
      now = new Date("2030-01-31T10:00:09.999Z");
      expect(value(await worker.reconcileMethodFlows())).toMatchObject({
        applied: 0,
      });
      expect(value(await worker.changeMethod(s.buyer, command))).toMatchObject({
        state: "started",
        formUrl: null,
      });
      now = new Date("2030-01-31T10:00:10Z");
      value(await worker.reconcileMethodFlows());
      expect(value(await worker.changeMethod(s.buyer, command))).toMatchObject({
        state: "rejected",
        formUrl: null,
      });
    } finally {
      gate.release();
      await settled;
    }
    expect(await changing).toMatchObject({
      ok: false,
      error: { code: "provider_unavailable" },
    });
    expect(value(await worker.changeMethod(s.buyer, command))).toMatchObject({
      state: "rejected",
      formUrl: null,
    });
    const next = value(
      await worker.changeMethod(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
      }),
    );
    expect(next).toMatchObject({
      state: "started",
      formUrl: "https://securepay.tinkoff.ru/binding",
    });
    expect(value(await worker.reconcileMethodFlows())).toMatchObject({
      applied: 1,
    });
    expect((await s.view())?.paymentMethod?.methodRef).toBe(next.flowRef);
    expect(s.bank.addCardCalls).toBe(2);
  });

  test("смена карты применяется доказанным token и не включает отменённое продление", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const canceled = value(
      await s.subscriptions.cancel(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
      }),
    );
    const started = value(
      await s.subscriptions.changeMethod(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: canceled.revision,
      }),
    );
    expect(started).toMatchObject({
      state: "started",
      formUrl: "https://securepay.tinkoff.ru/binding",
    });
    s.bank.failBindingState = true;
    await expect(runRenewalJob(s.payments, s.subscriptions)).rejects.toThrow(
      "provider_unavailable",
    );
    expect((await s.view())?.pendingMethodChange?.flowRef).toBe(
      started.flowRef,
    );
    s.bank.failBindingState = false;
    s.bank.binding = {
      status: "3DS_CHECKING",
      success: true,
      rebillId: undefined,
    };
    expect(value(await s.subscriptions.reconcileMethodFlows())).toMatchObject({
      inspected: 1,
      applied: 0,
    });
    expect((await s.view())?.paymentMethod?.methodRef).toBe(
      active?.paymentMethod?.methodRef,
    );
    s.bank.binding = {
      status: "COMPLETED",
      success: true,
      rebillId: "synthetic-new-card",
    };
    expect(value(await s.subscriptions.reconcileMethodFlows())).toMatchObject({
      inspected: 1,
      applied: 1,
    });
    const changed = await s.view();
    expect(changed?.state).toBe("canceled");
    expect(changed?.paymentMethod?.methodRef).toBe(started.flowRef);
    expect(changed?.pendingMethodChange).toBeNull();
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({
      inspected: 0,
      started: 0,
    });
    expect(s.bank.chargeCalls).toBe(0);
  });

  test("отозванная привязка закрывает новые отправки и завершает расписание", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const methodRef = active?.paymentMethod?.methodRef;
    expect(
      await s.subscriptions.revokeMethod(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        paymentMethodRef: randomUUID(),
      }),
    ).toMatchObject({ error: { code: "not_found" } });
    const revoked = value(
      await s.subscriptions.revokeMethod(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        paymentMethodRef: methodRef,
      }),
    );
    expect(revoked.paymentMethod).toMatchObject({ methodRef, revoked: true });
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({
      inspected: 0,
      started: 0,
      blocked: 0,
      closed: 1,
    });
    expect(s.bank.initCalls).toBe(1);
    expect(await s.view()).toBeNull();
  });

  test("конкурирующие продление, повышение и отмена не создают два платежа", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const higher = await s.offer(
      "Материалы и сопровождение",
      ["materials", "support"],
      1,
      350_000,
    );
    now = new Date("2030-02-01T00:00:00Z");
    const active = await s.view();
    const quoted = value(
      await s.subscriptions.quoteChange(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        paymentOptionId: higher,
      }),
    );
    const chargesBefore = s.bank.chargeCalls;
    const results = await Promise.all([
      s.payments.renew(),
      s.subscriptions.change(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
        changeQuoteRef: quoted.changeQuoteRef,
      }),
      s.subscriptions.cancel(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
      }),
    ]);
    expect(results.some((result) => result.ok)).toBe(true);
    expect(
      await db.prisma.billingPurchase.count({
        where: { accountId: s.buyer, kind: { not: "initial" } },
      }),
    ).toBeLessThanOrEqual(1);
    expect(s.bank.chargeCalls - chargesBefore).toBeLessThanOrEqual(1);
  });

  test("повтор operationId возвращает исходный результат, чужая нагрузка конфликтует", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const operationId = randomUUID();
    const first = value(
      await s.subscriptions.cancel(s.buyer, {
        operationId,
        expectedRevision: active?.revision,
      }),
    );
    expect(
      value(
        await s.subscriptions.cancel(s.buyer, {
          operationId,
          expectedRevision: active?.revision,
        }),
      ),
    ).toEqual(first);
    expect(
      await s.subscriptions.cancel(s.buyer, {
        operationId,
        expectedRevision: first.revision,
      }),
    ).toMatchObject({ error: { code: "operation_conflict" } });
    expect(
      await s.subscriptions.cancel(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
      }),
    ).toMatchObject({ error: { code: "revision_conflict" } });
  });

  test("возобновление отличает отказ чтения согласия от его отсутствия", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const canceled = value(
      await s.subscriptions.cancel(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
      }),
    );
    const operationId = randomUUID();
    const command = {
      operationId,
      expectedRevision: canceled.revision,
      consentEvidenceRefs: await s.consentFor(
        operationId,
        {
          snapshot: canceled.snapshot,
          nextChargeAt: new Date(canceled.paidUntil),
        },
        "subscription-resume",
      ),
    };
    await db.prisma
      .$executeRaw`ALTER TABLE accounts.legal_acceptances RENAME TO unavailable_legal_acceptances`;
    try {
      expect(await s.subscriptions.resume(s.buyer, command)).toMatchObject({
        ok: false,
        error: { code: "dependency_unavailable" },
      });
      const { app, server } = await httpFor(s);
      try {
        const response = await server.inject({
          method: "POST",
          headers: { authorization: "Bearer synthetic-buyer" },
          url: "/accounts/current/billing/subscription/resume",
          payload: command,
        });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({
          code: "dependency_unavailable",
        });
      } finally {
        await app.close();
      }
    } finally {
      await db.prisma
        .$executeRaw`ALTER TABLE accounts.unavailable_legal_acceptances RENAME TO legal_acceptances`;
    }
    expect(await s.view()).toMatchObject({
      state: "canceled",
      revision: canceled.revision,
    });
    expect(
      await s.subscriptions.resume(s.buyer, {
        ...command,
        consentEvidenceRefs: [randomUUID()],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "consent_required" },
    });
    const { app, server } = await httpFor(s);
    try {
      const response = await server.inject({
        method: "POST",
        headers: { authorization: "Bearer synthetic-buyer" },
        url: "/accounts/current/billing/subscription/resume",
        payload: { ...command, consentEvidenceRefs: [randomUUID()] },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: "consent_required" });
    } finally {
      await app.close();
    }

    expect(
      await s.subscriptions.resume(s.buyer, {
        ...command,
        consentEvidenceRefs: await s.consentFor(
          randomUUID(),
          {
            snapshot: canceled.snapshot,
            nextChargeAt: new Date(canceled.paidUntil),
          },
          "subscription-resume",
        ),
      }),
    ).toMatchObject({ ok: false, error: { code: "consent_required" } });
    expect(await s.subscriptions.resume(s.buyer, command)).toMatchObject({
      ok: true,
      value: { state: "active" },
    });
  });

  test("возобновление требует явного согласия и действует только внутри оплаченного срока", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const canceled = value(
      await s.subscriptions.cancel(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: active?.revision,
      }),
    );
    expect(
      await s.subscriptions.resume(s.buyer, {
        operationId: randomUUID(),
        expectedRevision: canceled.revision,
        consentEvidenceRefs: [randomUUID()],
      }),
    ).toMatchObject({ error: { code: "consent_required" } });
    const operationId = randomUUID();
    const resumed = value(
      await s.subscriptions.resume(s.buyer, {
        operationId,
        expectedRevision: canceled.revision,
        consentEvidenceRefs: await s.consentFor(
          operationId,
          {
            snapshot: canceled.snapshot,
            nextChargeAt: new Date(canceled.paidUntil),
          },
          "subscription-resume",
        ),
      }),
    );
    expect(resumed).toMatchObject({ state: "active" });
    now = new Date("2030-02-28T10:00:00Z");
    value(await s.payments.renew());
    expect((await s.view())?.periodIndex).toBe(2);
  });
});
