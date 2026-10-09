import { runRecoveryJob } from "../../src/entrypoints/billing-worker/jobs.js";
import { prepareInvitedQuote } from "./setup/purchase-invitation.js";
import { assembleTestBillingPricing } from "./setup/billing-pricing.js";
import { randomUUID } from "node:crypto";
import type { BillingPrismaClient } from "../../src/infrastructure/prisma/index.js";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import {
  assembleAccounts,
  BillingContact,
} from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/account-rights/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import {
  BillingNotices,
  BillingOperations,
  BillingPayments,
  type BillingPricing,
  BillingSubscriptions,
} from "../../src/modules/billing/index.js";
import type {
  OwnerOutcome,
  OwnerResult,
} from "../../src/modules/billing/domain/owner-operations.js";
import {
  Tbank,
  tbankToken,
} from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import {
  pressedPaymentButton,
  syntheticConsentDocuments,
  type RenewalSource,
} from "./setup/consent-documents.js";

function value<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
function failure(result: OwnerResult): string {
  if (result.ok) throw new Error(`Unexpected success ${result.result.outcome}`);
  return result.error.code;
}
/** Разбор владельческого результата по его виду: тест читает ровно ту форму, которую объявил контракт. */
function success(result: OwnerResult): OwnerOutcome {
  if (!result.ok) throw new Error(result.error.code);
  return result.result;
}
function unexpected(outcome: OwnerOutcome): Error {
  return new Error(`Unexpected outcome ${outcome.outcome}`);
}
function asCatalog(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "catalog") throw unexpected(value);
  return value;
}
function asCatalogOffers(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "catalogOffers") throw unexpected(value);
  return value;
}
function asPayments(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "payments") throw unexpected(value);
  return value;
}
function asPayment(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "payment") throw unexpected(value);
  return value;
}
function asReconciled(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "reconciled") throw unexpected(value);
  return value;
}
function asRefundDecision(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "refundDecision") throw unexpected(value);
  return value;
}
function asRefunds(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "refunds") throw unexpected(value);
  return value;
}
function asGrants(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grants") throw unexpected(value);
  return value;
}
function asGrantPreview(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grantPreview") throw unexpected(value);
  return value;
}
function asGrantBatch(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grantBatch") throw unexpected(value);
  return value;
}
function asGrant(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grant") throw unexpected(value);
  return value;
}
function asClassification(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "classification") throw unexpected(value);
  return value;
}

const config = syntheticTbankConfig({
  environment: "demo",
  terminalKey: "SYNTHETICOWNER",
  password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 61).toString("base64"),
  recurringCardConfirmed: true,
  cardOnlyHostedConfirmed: true,
  minimumKopecks: 100,
  maximumKopecks: 10_000_000,
  returnUrl: "https://inside.example.test/account",
  notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" },
});
const documents = syntheticConsentDocuments;
const requestSchema = z
  .object({
    OrderId: z.string().optional(),
    PaymentId: z.string().optional(),
    Amount: z.number().optional(),
    ExternalRequestId: z.string().optional(),
    Token: z.string(),
  })
  .loose();
const savedBinding = "synthetic-owner-card";

/** Управляемый банк: возврат отвечает только тем, что задал сценарий, и запоминает каждый запрос. */
class BankFixture {
  readonly orders = new Map<
    string,
    { paymentId: string; amount: number; status: string }
  >();
  readonly cancels: {
    externalRequestId: string;
    paymentId: string;
    amount: number;
  }[] = [];
  private readonly scope = randomUUID();
  failCancel = false;
  cancelStatus = "REFUNDED";
  cancelSucceeds = true;
  beforeCancelReturn: (() => Promise<void>) | undefined;

  event(orderId: string, extra: Record<string, unknown> = {}) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("Unknown synthetic order");
    return {
      TerminalKey: config.terminalKey,
      OrderId: orderId,
      PaymentId: order.paymentId,
      Amount: order.amount,
      Status: order.status,
      Success: true,
      ErrorCode: "0",
      ...extra,
    };
  }
  notify(orderId: string, status: string, extra: Record<string, unknown> = {}) {
    const order = this.orders.get(orderId);
    if (order) order.status = status;
    const body = this.event(orderId, { Status: status, ...extra });
    return { ...body, Token: tbankToken(body, config.password) };
  }
  client(): Tbank {
    return new Tbank(config, async (url, init) => {
      const response = this.respond(url, init);
      if (typeof url === "string" && url.endsWith("/Cancel"))
        await this.beforeCancelReturn?.();
      return response;
    });
  }
  private respond(
    url: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ): Response {
    if (typeof url !== "string" || typeof init?.body !== "string")
      throw new Error("Unexpected bank request");
    const body = requestSchema.parse(JSON.parse(init.body));
    if (url.endsWith("/Init")) {
      const orderId = z.string().parse(body.OrderId);
      this.orders.set(orderId, {
        paymentId: `${this.scope}-${this.orders.size + 1}`,
        amount: z.number().parse(body.Amount),
        status: "NEW",
      });
      return Response.json({
        ...this.event(orderId),
        PaymentURL: "https://securepay.tinkoff.ru/test",
      });
    }
    if (url.endsWith("/Cancel")) {
      const paymentId = z.string().parse(body.PaymentId);
      const [orderId, order] = this.byPayment(paymentId);
      this.cancels.push({
        externalRequestId: z.string().parse(body.ExternalRequestId),
        paymentId,
        amount: z.number().parse(body.Amount),
      });
      if (this.failCancel)
        throw new Error("Synthetic Cancel timeout after bank acceptance");
      return Response.json({
        TerminalKey: config.terminalKey,
        OrderId: orderId,
        PaymentId: paymentId,
        Status: this.cancelStatus,
        Success: this.cancelSucceeds,
        ErrorCode: this.cancelSucceeds ? "0" : "3007",
        OriginalAmount: order.amount,
      });
    }
    if (url.endsWith("/GetState"))
      return Response.json(
        this.event(this.byPayment(z.string().parse(body.PaymentId))[0]),
      );
    if (url.endsWith("/CheckOrder")) {
      const orderId = z.string().parse(body.OrderId);
      const order = this.orders.get(orderId);
      return Response.json({
        Success: true,
        ErrorCode: "0",
        TerminalKey: config.terminalKey,
        OrderId: orderId,
        Payments: order
          ? [
              {
                PaymentId: order.paymentId,
                Status: order.status,
                Success: true,
              },
            ]
          : [],
      });
    }
    throw new Error(`Unexpected bank method ${url}`);
  }
  private byPayment(
    paymentId: string,
  ): [string, { paymentId: string; amount: number; status: string }] {
    const entry = [...this.orders].find(
      ([, order]) => order.paymentId === paymentId,
    );
    if (!entry) throw new Error("Unknown synthetic payment");
    return entry;
  }
}

describe("владельческие операции billing: платежи, возвраты и ручные права (реальный PostgreSQL, синтетический банк)", () => {
  let db: TestDatabase;
  let now = new Date("2030-03-31T10:00:00Z");
  let owner: string;
  let administrator: string;
  let outsider: string;
  let pricing: BillingPricing;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let accounts: ReturnType<typeof assembleAccounts>;
  let contact: BillingContact;
  const codes = new Map<string, string>();

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = randomUUID();
    administrator = randomUUID();
    outsider = randomUUID();
    for (const id of [owner, administrator, outsider])
      await db.prisma.account.create({
        data: {
          id,
          logtoIssuer: "https://identity.example.test",
          logtoSubject: id,
        },
      });
    // Владельческие операции проходят на одном scoped billing:manage: новых ролей задача не создаёт.
    await db.prisma.accountPermission.create({
      data: { accountId: owner, permission: "billing:manage" },
    });
    // Классификация старой подписки принадлежит #404 и остаётся за platform:admin.
    await db.prisma.accountPermission.create({
      data: { accountId: administrator, permission: "platform:admin" },
    });
    await db.prisma.accountPermission.create({
      data: { accountId: outsider, permission: "materials:manage" },
    });
    accounts = assembleAccounts({
      prisma: db.prisma,
      emailFingerprintKey: "synthetic-owner-fingerprint-key-0000000",
    });
    grants = assembleAccessGrants({
      prisma: db.prisma,
      accounts,
      recipientLinks: new TelegramAccountLinks(db.prisma),
      clock: () => now,
    });
    pricing = assembleTestBillingPricing({
      prisma: db.prisma,
      accounts,
      clock: () => now,
      sale: { payments: true, subscriptions: true },
    });
    contact = new BillingContact({
      prisma: db.prisma,
      protection: billingContactProtection(
        Buffer.alloc(32, 62).toString("base64"),
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

  const paymentIdOf = async (purchaseRef: string) =>
    (
      await db.prisma.billingPurchase.findUniqueOrThrow({
        where: { id: purchaseRef },
      })
    ).paymentId;

  /** Аккаунт без истории: до решения владельца он остаётся неопределённым покупателем. */
  async function account(): Promise<string> {
    const id = randomUUID();
    await db.prisma.account.create({
      data: {
        id,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: id,
      },
    });
    return id;
  }
  const classifyNew = (accountId: string, expectedRevision = 0) => ({
    operation: "grants.classify" as const,
    operationId: randomUUID(),
    accountId,
    expectedRevision,
    classification: "confirmed_new" as const,
    sourceRef: `enrolment-${accountId}`,
    reason: "Заявка нового покупателя подтверждена",
    bridgeEnabled: false,
    tributeStopped: false,
  });
  const readClassification = (accountId: string) => ({
    operation: "grants.readClassification" as const,
    operationId: randomUUID(),
    accountId,
  });

  async function scenario(
    options: {
      readonly benefits?: readonly string[];
      readonly priceKopecks?: number;
      readonly operationsPrisma?: BillingPrismaClient;
    } = {},
  ) {
    now = new Date("2030-03-31T10:00:00Z");
    const buyer = randomUUID();
    const productId = randomUUID();
    await db.prisma.account.create({
      data: {
        id: buyer,
        logtoIssuer: "https://identity.example.test",
        logtoSubject: buyer,
      },
    });
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
          name: "Материалы и сопровождение",
          benefits: [...(options.benefits ?? ["materials", "support"])],
          // Продаваемый тариф открывает только явный состав; разовое предложение продукта его не несёт.
          ...(options.benefits?.some((benefit) =>
            benefit.startsWith("product:"),
          ) === true
            ? {}
            : { coverage: { productIds: [productId], materialIds: [] } }),
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
    const bank = new BankFixture();
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
    const subscriptions = new BillingSubscriptions({
      prisma: db.prisma,
      bank: client,
      contact,
      grants,
      payments,
      notices,
      clock: () => now,
    });
    const operations = new BillingOperations({
      prisma: options.operationsPrisma ?? db.prisma,
      accounts,
      pricing,
      payments,
      subscriptions,
      grants,
      bank: client,
      clock: () => now,
    });
    // Покупателя определяет та же владельческая операция, что и в админке: иначе подписка не начнётся.
    expect(
      asClassification(await operations.execute(owner, classifyNew(buyer)))
        .value,
    ).toMatchObject({
      classification: "confirmed_new",
      revision: 1,
      recurringAllowed: true,
    });

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
    async function reserve() {
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
      return value(
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
    }
    async function buy() {
      const purchase = await reserve();
      expect(
        await payments.notification(
          bank.notify(purchase.purchaseRef, "AUTHORIZED", {
            RebillId: savedBinding,
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
    /** Независимое бессрочное право на руководство: оно не связано с подпиской и её возвратом. */
    async function lifetimeProductGrant() {
      const preview = asGrantPreview(
        await operations.execute(owner, {
          operation: "grants.previewBatch",
          operationId: randomUUID(),
          rows: [
            {
              rowKey: "product",
              accountId: buyer,
              source: "manual",
              sourceRef: `product-${productId}`,
              terms: {
                capabilities: [`product:${productId}`],
                startsAt: "2030-01-01T00:00:00Z",
                validUntil: null,
                reason: "Курс полностью пройден",
              },
            },
          ],
        }),
      );
      expect(preview.rows).toEqual([
        { rowKey: "product", accountId: buyer, status: "confirmed" },
      ]);
      const applied = asGrantBatch(
        await operations.execute(owner, {
          operation: "grants.applyBatch",
          operationId: randomUUID(),
          previewRef: preview.previewRef,
          expectedRevision: preview.revision,
          confirmedRows: ["product"],
        }),
      );
      const row = applied.rows[0];
      if (row === undefined || !row.result.ok || !("grantRef" in row.result))
        throw new Error("Manual product grant was not applied");
      return row.result.grantRef;
    }
    const capabilities = async () => {
      const resolved = await grants.resolveCapabilities(buyer);
      if (!resolved.ok) throw new Error(resolved.error.code);
      return resolved.capabilities.map((entry) => entry.capability);
    };
    return {
      buyer,
      productId,
      offerId,
      optionId,
      bank,
      payments,
      subscriptions,
      operations,
      buy,
      reserve,
      consentFor,
      lifetimeProductGrant,
      capabilities,
    };
  }

  test("владелец определяет покупателя: повтор не пишет второй раз, конфликт редакции не пишет вовсе", async () => {
    const s = await scenario();
    const target = await account();
    // Аккаунт без решения владельца остаётся неопределённым, и автосписания ему запрещены.
    expect(
      asClassification(
        await s.operations.execute(owner, readClassification(target)),
      ).value,
    ).toEqual({
      accountId: target,
      classification: "unknown",
      revision: 0,
      recurringAllowed: false,
    });

    const decision = classifyNew(target);
    expect(
      asClassification(await s.operations.execute(owner, decision)).value,
    ).toEqual({
      accountId: target,
      classification: "confirmed_new",
      revision: 1,
      recurringAllowed: true,
    });
    // Тот же operationId возвращает сохранённый результат и не создаёт вторую запись изменения.
    expect(
      asClassification(await s.operations.execute(owner, decision)).value,
    ).toEqual({
      accountId: target,
      classification: "confirmed_new",
      revision: 1,
      recurringAllowed: true,
    });
    expect(
      await db.prisma.accessChange.count({
        where: { accountId: target, kind: "legacy_classified" },
      }),
    ).toBe(1);
    // Изменённая нагрузка под тем же operationId конфликтует, а не переписывает решение.
    expect(
      failure(
        await s.operations.execute(owner, {
          ...decision,
          reason: "Другое основание того же решения",
        }),
      ),
    ).toBe("operation_conflict");

    // Устаревшая редакция отклоняется без записи; состояние остаётся прежним.
    expect(
      failure(
        await s.operations.execute(owner, {
          ...classifyNew(target),
          classification: "unknown",
        }),
      ),
    ).toBe("revision_conflict");
    expect(
      asClassification(
        await s.operations.execute(owner, readClassification(target)),
      ).value,
    ).toEqual({
      accountId: target,
      classification: "confirmed_new",
      revision: 1,
      recurringAllowed: true,
    });

    // Старый покупатель без подтверждённой остановки Tribute автосписания не получает.
    const legacy = await account();
    expect(
      asClassification(
        await s.operations.execute(owner, {
          operation: "grants.classify",
          operationId: randomUUID(),
          accountId: legacy,
          expectedRevision: 0,
          classification: "confirmed_legacy",
          sourceRef: `tribute-${legacy}`,
          reason: "Выгрузка старой группы",
          bridgeEnabled: true,
          tributeStopped: false,
        }),
      ).value,
    ).toEqual({
      accountId: legacy,
      classification: "confirmed_legacy",
      revision: 1,
      recurringAllowed: false,
    });
    // Полномочие то же, что у остального набора: чужой актор не читает и не меняет состояние.
    for (const actor of [outsider, s.buyer]) {
      expect(
        failure(await s.operations.execute(actor, readClassification(target))),
      ).toBe("forbidden");
      expect(
        failure(
          await s.operations.execute(actor, classifyNew(await account())),
        ),
      ).toBe("forbidden");
    }
    expect(
      failure(await s.operations.execute(owner, classifyNew(randomUUID()))),
    ).toBe("not_found");
  });

  test("предпросмотр показывает устаревшую классификацию без изменения состояния и выдачи", async () => {
    const s = await scenario();
    const [classified, untouched, missing] = [
      await account(),
      await account(),
      randomUUID(),
    ];
    expect(
      asClassification(
        await s.operations.execute(owner, {
          ...classifyNew(classified),
          classification: "confirmed_legacy",
          bridgeEnabled: true,
        }),
      ).value,
    ).toMatchObject({ classification: "confirmed_legacy", revision: 1 });
    const command = {
      operation: "grants.previewBatch" as const,
      operationId: randomUUID(),
      rows: [
        ...[classified, untouched, missing].map((accountId, index) => ({
          rowKey: `classification-${String(index + 1)}`,
          accountId,
          expectedRevision: 0,
          classification: "confirmed_new" as const,
          sourceRef: `cohort-${accountId}`,
          reason: "Подтверждённый участник",
          bridgeEnabled: false,
          tributeStopped: false,
        })),
        {
          rowKey: "grant",
          accountId: untouched,
          source: "manual" as const,
          sourceRef: `support-${untouched}`,
          terms: {
            capabilities: ["support" as const],
            startsAt: "2030-03-01T00:00:00Z",
            validUntil: null,
            reason: "Ручное сопровождение",
          },
        },
      ],
    };
    for (const actor of [outsider, s.buyer])
      expect(failure(await s.operations.execute(actor, command))).toBe(
        "forbidden",
      );
    const before = await db.prisma.legacyClassification.findUniqueOrThrow({
      where: { accountId: classified },
    });
    const preview = asGrantPreview(await s.operations.execute(owner, command));
    expect(preview.rows).toEqual([
      {
        rowKey: "classification-1",
        accountId: classified,
        status: "confirmed",
        current: { classification: "confirmed_legacy", revision: 1 },
      },
      {
        rowKey: "classification-2",
        accountId: untouched,
        status: "confirmed",
        current: { classification: "unknown", revision: 0 },
      },
      {
        rowKey: "classification-3",
        accountId: missing,
        status: "not_found",
        current: null,
      },
      { rowKey: "grant", accountId: untouched, status: "confirmed" },
    ]);
    expect(
      await db.prisma.legacyClassification.findUniqueOrThrow({
        where: { accountId: classified },
      }),
    ).toEqual(before);
    expect(
      await db.prisma.legacyClassification.findUnique({
        where: { accountId: untouched },
      }),
    ).toBeNull();
    const stored = await db.prisma.accessBatchPreview.findUniqueOrThrow({
      where: { id: preview.previewRef },
    });
    const confirmedIdentity: unknown = expect.any(String);
    expect(stored.rows).toEqual(
      command.rows.map((row) => ({
        ...row,
        identityFingerprint:
          row.accountId === missing ? null : confirmedIdentity,
      })),
    );
    expect(asGrantPreview(await s.operations.execute(owner, command))).toEqual(
      preview,
    );
    const apply = {
      operation: "grants.applyBatch" as const,
      operationId: randomUUID(),
      previewRef: preview.previewRef,
      expectedRevision: preview.revision,
      confirmedRows: ["grant", "classification-2", "classification-1"],
    };
    expect(failure(await s.operations.execute(owner, apply))).toBe(
      "revision_conflict",
    );
    expect(
      asClassification(
        await s.operations.execute(owner, readClassification(untouched)),
      ).value,
    ).toMatchObject({ classification: "unknown", revision: 0 });
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: untouched } }),
    ).toBe(0);
    expect(
      await db.prisma.accessChange.count({
        where: { accountId: { in: [classified, untouched] } },
      }),
    ).toBe(1);
    expect(
      await db.prisma.accessReceipt.findUnique({
        where: {
          scope_operationId: { scope: owner, operationId: apply.operationId },
        },
      }),
    ).toBeNull();
  });

  test("набор классифицируется через тот же предпросмотр и применение, что и ручная выдача", async () => {
    const s = await scenario();
    const [first, second] = [await account(), await account()];
    const rows = [first, second].map((accountId, index) => ({
      rowKey: `row-${String(index + 1)}`,
      accountId,
      expectedRevision: 0,
      classification: "confirmed_new" as const,
      sourceRef: `cohort-${accountId}`,
      reason: "Перенос подтверждённого участника",
      bridgeEnabled: false,
      tributeStopped: false,
    }));
    const preview = asGrantPreview(
      await s.operations.execute(owner, {
        operation: "grants.previewBatch",
        operationId: randomUUID(),
        rows,
      }),
    );
    expect(preview.rows).toEqual([
      {
        rowKey: "row-1",
        accountId: first,
        status: "confirmed",
        current: { classification: "unknown", revision: 0 },
      },
      {
        rowKey: "row-2",
        accountId: second,
        status: "confirmed",
        current: { classification: "unknown", revision: 0 },
      },
    ]);
    // Предпросмотр ничего не записал: состояние обоих аккаунтов не изменилось.
    expect(
      await db.prisma.legacyClassification.count({
        where: { accountId: { in: [first, second] } },
      }),
    ).toBe(0);

    const applied = asGrantBatch(
      await s.operations.execute(owner, {
        operation: "grants.applyBatch",
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        expectedRevision: preview.revision,
        confirmedRows: ["row-1", "row-2"],
      }),
    );
    expect(applied.rows).toEqual([
      {
        rowKey: "row-1",
        result: { ok: true, classification: "confirmed_new", revision: 1 },
      },
      {
        rowKey: "row-2",
        result: { ok: true, classification: "confirmed_new", revision: 1 },
      },
    ]);
    for (const accountId of [first, second])
      expect(
        asClassification(
          await s.operations.execute(owner, readClassification(accountId)),
        ).value,
      ).toMatchObject({
        classification: "confirmed_new",
        revision: 1,
        recurringAllowed: true,
      });

    // Одна устаревшая строка отменяет весь набор: соседний аккаунт остаётся неопределённым.
    const [third, fourth] = [await account(), await account()];
    const stale = asGrantPreview(
      await s.operations.execute(owner, {
        operation: "grants.previewBatch",
        operationId: randomUUID(),
        rows: [third, fourth].map((accountId, index) => ({
          rowKey: `stale-${String(index + 1)}`,
          accountId,
          expectedRevision: 0,
          classification: "confirmed_new" as const,
          sourceRef: `cohort-${accountId}`,
          reason: "Перенос подтверждённого участника",
          bridgeEnabled: false,
          tributeStopped: false,
        })),
      }),
    );
    expect(stale.rows).toEqual([
      {
        rowKey: "stale-1",
        accountId: third,
        status: "confirmed",
        current: { classification: "unknown", revision: 0 },
      },
      {
        rowKey: "stale-2",
        accountId: fourth,
        status: "confirmed",
        current: { classification: "unknown", revision: 0 },
      },
    ]);
    expect(
      asClassification(await s.operations.execute(owner, classifyNew(third)))
        .value,
    ).toMatchObject({ revision: 1 });
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "grants.applyBatch",
          operationId: randomUUID(),
          previewRef: stale.previewRef,
          expectedRevision: stale.revision,
          confirmedRows: ["stale-1", "stale-2"],
        }),
      ),
    ).toBe("revision_conflict");
    expect(
      asClassification(
        await s.operations.execute(owner, readClassification(fourth)),
      ).value,
    ).toMatchObject({ classification: "unknown", revision: 0 });
  });

  test("владелец читает платежи, условия и остаток к возврату без банковских секретов", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const page = asPayments(
      await s.operations.execute(owner, {
        operation: "payments.list",
        operationId: randomUUID(),
        accountId: s.buyer,
      }),
    );
    expect(page).toMatchObject({ nextCursor: null });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      purchaseRef,
      accountId: s.buyer,
      kind: "initial",
      state: "confirmed",
      amountKopecks: 100_000,
      refundedKopecks: 0,
      refundableKopecks: 100_000,
      access: "ready",
      fiscalization: "pending",
    });
    const stored = await db.prisma.billingPurchase.findUniqueOrThrow({
      where: { id: purchaseRef },
    });
    const serialized = JSON.stringify(page);
    for (const secret of [
      savedBinding,
      `${s.buyer}@example.test`,
      z.object({ emailCiphertext: z.string() }).parse(stored.contact)
        .emailCiphertext,
      z.string().parse(stored.bindingCiphertext),
    ])
      expect(serialized).not.toContain(secret);
    const detail = asPayment(
      await s.operations.execute(owner, {
        operation: "payments.read",
        operationId: randomUUID(),
        purchaseRef,
      }),
    );
    expect(detail.events.map((event) => event.kind)).toEqual([
      "payment_confirmed",
    ]);
    expect(detail.decisions).toEqual([]);
    expect(detail.audit).toEqual([]);
    // Сверка перечитывает банк и не создаёт новый платёж.
    const initCalls = s.bank.orders.size;
    expect(
      asReconciled(
        await s.operations.execute(owner, {
          operation: "payments.reconcile",
          operationId: randomUUID(),
          purchaseRef,
        }),
      ).value,
    ).toMatchObject({ purchaseRef, state: "confirmed" });
    expect(s.bank.orders.size).toBe(initCalls);
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "payments.read",
          operationId: randomUUID(),
          purchaseRef: randomUUID(),
        }),
      ),
    ).toBe("not_found");
  });

  test("полный возврат отменяет продление, но сам не отзывает доступ и не трогает бессрочное право", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const productGrant = await s.lifetimeProductGrant();
    const decided = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.decide",
        operationId: randomUUID(),
        purchaseRef,
        amountKopecks: 100_000,
        basis: "compensation",
        recurring: "cancel",
        reason: "Обращение в поддержку: полный возврат",
      }),
    ).value;
    expect(decided).toMatchObject({
      state: "decided",
      revision: 1,
      amountKopecks: 100_000,
      basis: "compensation",
      recurring: "cancel",
      attempt: null,
    });
    const executed = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.execute",
        operationId: randomUUID(),
        decisionRef: decided.decisionRef,
        expectedRevision: 1,
      }),
    ).value;
    expect(executed).toMatchObject({
      state: "executed",
      revision: 3,
      attempt: {
        state: "confirmed",
        amountKopecks: 100_000,
        observedStatus: "REFUNDED",
        errorCode: "0",
      },
    });
    const sent = s.bank.cancels;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      externalRequestId: executed.attempt?.refundRef,
      amount: 100_000,
    });
    expect(sent[0]?.paymentId).toBe(await paymentIdOf(purchaseRef));
    // Компенсация без отказа от договора доступ не отзывает.
    value(await s.payments.recover());
    expect(await s.capabilities()).toEqual([
      "community",
      "materials",
      `product:${s.productId}`,
      "support",
    ]);
    expect(
      await db.prisma.accessGrant.findUniqueOrThrow({
        where: { id: productGrant },
      }),
    ).toMatchObject({ revokedAt: null, validUntil: null });
    expect(
      value(await s.subscriptions.read(s.buyer)).subscription,
    ).toMatchObject({
      state: "canceled",
      paidUntil: "2030-04-30T10:00:00.000Z",
    });
    const totals = asRefunds(
      await s.operations.execute(owner, {
        operation: "refunds.read",
        operationId: randomUUID(),
        purchaseRef,
      }),
    );
    expect(totals).toMatchObject({
      refundedKopecks: 100_000,
      refundableKopecks: 0,
    });
    expect(totals.decisions).toHaveLength(1);
    // Основание решает доступ: база не принимает расхождения, а решение без основания читается как есть.
    await expect(
      db.prisma.billingRefundDecision.update({
        where: { id: decided.decisionRef },
        data: { access: "revoke" },
      }),
    ).rejects.toThrow();
    await db.prisma.billingRefundDecision.update({
      where: { id: decided.decisionRef },
      data: { basis: null },
    });
    expect(
      asRefunds(
        await s.operations.execute(owner, {
          operation: "refunds.read",
          operationId: randomUUID(),
          purchaseRef,
        }),
      ).decisions,
    ).toMatchObject([
      { decisionRef: decided.decisionRef, basis: null, access: "keep" },
    ]);
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "refunds.decide",
          operationId: randomUUID(),
          purchaseRef,
          amountKopecks: 100,
          basis: "compensation",
          recurring: "keep",
          reason: "Повторный возврат сверх суммы",
        }),
      ),
    ).toBe("unsupported_amount");
    const audit = asPayment(
      await s.operations.execute(owner, {
        operation: "payments.read",
        operationId: randomUUID(),
        purchaseRef,
      }),
    ).audit;
    // Каждая применённая команда сохранила исполнителя, основание и результат; секретов в них нет.
    expect(audit.map((entry) => entry.operation)).toEqual([
      "refunds.decide",
      "refunds.execute",
    ]);
    expect(audit.every((entry) => entry.actorId === owner)).toBe(true);
    expect(audit[0]?.reason).toBe("Обращение в поддержку: полный возврат");
    expect(audit[1]?.reason).toBe("Обращение в поддержку: полный возврат");
    expect(JSON.stringify(audit)).not.toContain(savedBinding);
  });

  test("два решения о полном возврате не исполняются дважды: остаток проверяется при отправке", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const decide = async (reason: string) =>
      asRefundDecision(
        await s.operations.execute(owner, {
          operation: "refunds.decide",
          operationId: randomUUID(),
          purchaseRef,
          amountKopecks: 100_000,
          basis: "compensation",
          recurring: "keep",
          reason,
        }),
      ).value;
    // Решение ничего не резервирует: сумма проверяется в момент отправки под замком платежа.
    const first = await decide("Первое решение о полном возврате");
    const second = await decide("Второе решение о том же платеже");
    expect(
      asRefundDecision(
        await s.operations.execute(owner, {
          operation: "refunds.execute",
          operationId: randomUUID(),
          decisionRef: first.decisionRef,
          expectedRevision: 1,
        }),
      ).value,
    ).toMatchObject({ state: "executed" });
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "refunds.execute",
          operationId: randomUUID(),
          decisionRef: second.decisionRef,
          expectedRevision: 1,
        }),
      ),
    ).toBe("unsupported_amount");
    expect(s.bank.cancels).toHaveLength(1);
    expect(
      await db.prisma.billingRefund.count({ where: { purchaseRef } }),
    ).toBe(1);
    expect(
      asRefunds(
        await s.operations.execute(owner, {
          operation: "refunds.read",
          operationId: randomUUID(),
          purchaseRef,
        }),
      ),
    ).toMatchObject({ refundedKopecks: 100_000, refundableKopecks: 0 });
  });

  test("потерянный ответ банка оставляет возврат неизвестным и сверяется той же попыткой", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const decided = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.decide",
        operationId: randomUUID(),
        purchaseRef,
        amountKopecks: 40_000,
        basis: "compensation",
        recurring: "keep",
        reason: "Частичный возврат за неиспользованный срок",
      }),
    ).value;
    s.bank.failCancel = true;
    const pending = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.execute",
        operationId: randomUUID(),
        decisionRef: decided.decisionRef,
        expectedRevision: 1,
      }),
    ).value;
    expect(pending).toMatchObject({
      state: "executing",
      attempt: {
        state: "unknown",
        observedStatus: "no_response",
        amountKopecks: 40_000,
      },
    });
    // Незавершённый возврат удерживает свою сумму и не разрешает вторую отправку.
    expect(
      asRefunds(
        await s.operations.execute(owner, {
          operation: "refunds.read",
          operationId: randomUUID(),
          purchaseRef,
        }),
      ),
    ).toMatchObject({ refundedKopecks: 0, refundableKopecks: 60_000 });
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "refunds.execute",
          operationId: randomUUID(),
          decisionRef: decided.decisionRef,
          expectedRevision: 2,
        }),
      ),
    ).toBe("refund_in_progress");
    // Незавершённая попытка одного решения закрывает отправку и по любому другому решению.
    const parallel = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.decide",
        operationId: randomUUID(),
        purchaseRef,
        amountKopecks: 10_000,
        basis: "compensation",
        recurring: "keep",
        reason: "Второе решение при незавершённой попытке",
      }),
    ).value;
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "refunds.execute",
          operationId: randomUUID(),
          decisionRef: parallel.decisionRef,
          expectedRevision: 1,
        }),
      ),
    ).toBe("refund_in_progress");
    expect(
      await db.prisma.billingRefund.count({ where: { purchaseRef } }),
    ).toBe(1);
    expect(s.bank.cancels).toHaveLength(1);
    s.bank.failCancel = false;
    expect(await s.operations.reconcileRefunds()).toEqual({
      status: "ready",
      inspected: 1,
      settled: 1,
      failed: 0,
    });
    // Повтор с прежним ExternalRequestId банк считает тем же запросом: второй возврат не создаётся.
    expect(s.bank.cancels).toHaveLength(2);
    expect(
      new Set(s.bank.cancels.map((cancel) => cancel.externalRequestId)).size,
    ).toBe(1);
    expect(
      await db.prisma.billingRefund.count({ where: { purchaseRef } }),
    ).toBe(1);
    const settled = asRefunds(
      await s.operations.execute(owner, {
        operation: "refunds.read",
        operationId: randomUUID(),
        purchaseRef,
      }),
    );
    expect(settled).toMatchObject({
      refundedKopecks: 40_000,
      refundableKopecks: 60_000,
    });
    expect(
      settled.decisions.find(
        (entry) => entry.decisionRef === decided.decisionRef,
      ),
    ).toMatchObject({ state: "executed", attempt: { state: "confirmed" } });
  });

  test("подтверждённый возврат один раз сообщает покупателю и виден в его истории", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const refundNotices = () =>
      db.prisma.billingNotice.findMany({
        where: { accountId: s.buyer, kind: "refund_resolved" },
      });
    const decided = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.decide",
        operationId: randomUUID(),
        purchaseRef,
        amountKopecks: 40_000,
        basis: "compensation",
        recurring: "keep",
        reason: "Частичный возврат с сообщением покупателю",
      }),
    ).value;
    s.bank.failCancel = true;
    asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.execute",
        operationId: randomUUID(),
        decisionRef: decided.decisionRef,
        expectedRevision: 1,
      }),
    );
    // Пока банк не подтвердил возврат, покупателю сообщать не о чем.
    expect(await refundNotices()).toEqual([]);
    expect(
      value(await s.payments.history(s.buyer)).find(
        (payment) => payment.purchaseRef === purchaseRef,
      ),
    ).toMatchObject({ refundedKopecks: 0, refundedAt: null });
    await expect(runRecoveryJob(s.payments, s.operations)).rejects.toThrow(
      "provider_unavailable",
    );
    expect(await refundNotices()).toEqual([]);
    s.bank.failCancel = false;
    expect(await s.operations.reconcileRefunds()).toEqual({
      status: "ready",
      inspected: 1,
      settled: 1,
      failed: 0,
    });
    expect(await s.operations.reconcileRefunds()).toEqual({
      status: "ready",
      inspected: 0,
      settled: 0,
      failed: 0,
    });
    const notices = await refundNotices();
    expect(notices).toHaveLength(1);
    const [notice] = notices;
    if (notice === undefined) throw new Error("refund notice missing");
    expect(notice).toMatchObject({
      amountKopecks: 40_000n,
      state: "current",
      attemptRef: purchaseRef,
    });
    expect(
      await db.prisma.billingNoticeRevision.count({
        where: { noticeRef: notice.id },
      }),
    ).toBe(1);
    const payment = value(await s.payments.history(s.buyer)).find(
      (entry) => entry.purchaseRef === purchaseRef,
    );
    expect(payment).toMatchObject({
      state: "confirmed",
      refundedKopecks: 40_000,
    });
    expect(payment?.refundedAt).not.toBeNull();
  });

  test("попытка, оставшаяся отправленной после сбоя процесса, сверяется и не отправляется заново", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const decided = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.decide",
        operationId: randomUUID(),
        purchaseRef,
        amountKopecks: 20_000,
        basis: "compensation",
        recurring: "keep",
        reason: "Возврат с потерей процесса",
      }),
    ).value;
    s.bank.failCancel = true;
    asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.execute",
        operationId: randomUUID(),
        decisionRef: decided.decisionRef,
        expectedRevision: 1,
      }),
    );
    // Сбой между сохранением попытки и ответом банка не успевает записать даже `unknown`.
    const attempt = await db.prisma.billingRefund.findFirstOrThrow({
      where: { purchaseRef },
    });
    await db.prisma.billingRefund.update({
      where: { id: attempt.id },
      data: { state: "sent", observedStatus: null },
    });
    s.bank.failCancel = false;
    expect(await s.operations.reconcileRefunds()).toEqual({
      status: "ready",
      inspected: 1,
      settled: 1,
      failed: 0,
    });
    expect(
      new Set(s.bank.cancels.map((cancel) => cancel.externalRequestId)),
    ).toEqual(new Set([attempt.id]));
    expect(
      await db.prisma.billingRefund.count({ where: { purchaseRef } }),
    ).toBe(1);
    expect(
      asRefunds(
        await s.operations.execute(owner, {
          operation: "refunds.read",
          operationId: randomUUID(),
          purchaseRef,
        }),
      ),
    ).toMatchObject({ refundedKopecks: 20_000, refundableKopecks: 80_000 });
  });

  test("отзыв доступа исполняется только по подтверждённому возврату и только для оплаченного основания", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const productGrant = await s.lifetimeProductGrant();
    const decided = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.decide",
        operationId: randomUUID(),
        purchaseRef,
        amountKopecks: 100_000,
        basis: "withdrawal",
        recurring: "keep",
        reason: "Возврат с отзывом оплаченного доступа",
      }),
    ).value;
    s.bank.cancelSucceeds = false;
    s.bank.cancelStatus = "REJECTED";
    const rejected = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.execute",
        operationId: randomUUID(),
        decisionRef: decided.decisionRef,
        expectedRevision: 1,
      }),
    ).value;
    // Неуспешный возврат не показывается исполненным и ничего не отзывает.
    expect(rejected).toMatchObject({
      state: "failed",
      attempt: {
        state: "failed",
        observedStatus: "REJECTED",
        errorCode: "3007",
      },
    });
    value(await s.payments.recover());
    expect(await s.capabilities()).toEqual([
      "community",
      "materials",
      `product:${s.productId}`,
      "support",
    ]);
    expect(
      asRefunds(
        await s.operations.execute(owner, {
          operation: "refunds.read",
          operationId: randomUUID(),
          purchaseRef,
        }),
      ),
    ).toMatchObject({ refundedKopecks: 0, refundableKopecks: 100_000 });
    s.bank.cancelSucceeds = true;
    s.bank.cancelStatus = "REFUNDED";
    const second = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.decide",
        operationId: randomUUID(),
        purchaseRef,
        amountKopecks: 100_000,
        basis: "withdrawal",
        recurring: "keep",
        reason: "Возврат подтверждён после исправления",
      }),
    ).value;
    expect(
      asRefundDecision(
        await s.operations.execute(owner, {
          operation: "refunds.execute",
          operationId: randomUUID(),
          decisionRef: second.decisionRef,
          expectedRevision: 1,
        }),
      ).value,
    ).toMatchObject({ state: "executed" });
    value(await s.payments.recover());
    // Отзывается ровно оплаченное основание этой покупки; независимое бессрочное право остаётся.
    expect(await s.capabilities()).toEqual([
      "community",
      `product:${s.productId}`,
    ]);
    const paid = await db.prisma.accessGrant.findMany({
      where: { accountId: s.buyer, source: "paid" },
    });
    expect(paid.length).toBeGreaterThan(0);
    expect(
      paid.every((grant) => grant.revokedAt !== null && grant.revision === 2),
    ).toBe(true);
    expect(
      await db.prisma.accessGrant.findUniqueOrThrow({
        where: { id: productGrant },
      }),
    ).toMatchObject({ revokedAt: null });
    expect(
      value(await s.subscriptions.read(s.buyer)).subscription,
    ).toMatchObject({ state: "active" });
    const history = asGrants(
      await s.operations.execute(owner, {
        operation: "grants.read",
        operationId: randomUUID(),
        accountId: s.buyer,
      }),
    ).value;
    expect(history.history.map((entry) => entry.kind)).toContain(
      "paid_revoked",
    );
  });

  test("сумма вне допустимого, неподтверждённый платёж и чужие полномочия отклоняются", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    for (const amountKopecks of [0, -100, 1.5]) {
      expect(
        failure(
          await s.operations.execute(owner, {
            operation: "refunds.decide",
            operationId: randomUUID(),
            purchaseRef,
            amountKopecks,
            basis: "compensation",
            recurring: "keep",
            reason: "Недопустимая сумма",
          }),
        ),
      ).toBe("invalid_request");
    }
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "refunds.decide",
          operationId: randomUUID(),
          purchaseRef,
          amountKopecks: 100_001,
          basis: "compensation",
          recurring: "keep",
          reason: "Больше оплаченного",
        }),
      ),
    ).toBe("unsupported_amount");
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "refunds.decide",
          operationId: randomUUID(),
          purchaseRef: randomUUID(),
          amountKopecks: 1_000,
          basis: "compensation",
          recurring: "keep",
          reason: "Неизвестный платёж",
        }),
      ),
    ).toBe("not_found");
    const other = await scenario();
    const prepared = await other.reserve();
    expect(
      failure(
        await other.operations.execute(owner, {
          operation: "refunds.decide",
          operationId: randomUUID(),
          purchaseRef: prepared.purchaseRef,
          amountKopecks: 1_000,
          basis: "compensation",
          recurring: "keep",
          reason: "Платёж ещё не подтверждён",
        }),
      ),
    ).toBe("state_conflict");
    // Одни полномочия для admin и MCP: и то и другое проходит через этот фасет.
    // platform:admin владельца включает billing:manage, поэтому прежний доступ сохраняется.
    expect(
      asPayments(
        await s.operations.execute(administrator, {
          operation: "payments.list",
          operationId: randomUUID(),
        }),
      ).items.length,
    ).toBeGreaterThan(0);
    for (const actor of [outsider, s.buyer])
      expect(
        failure(
          await s.operations.execute(actor, {
            operation: "payments.list",
            operationId: randomUUID(),
          }),
        ),
      ).toBe("forbidden");
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "refunds.execute",
          operationId: randomUUID(),
          decisionRef: randomUUID(),
          expectedRevision: 1,
        }),
      ),
    ).toBe("not_found");
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "payments.list",
          operationId: randomUUID(),
          cursor: "not-a-cursor",
        }),
      ),
    ).toBe("invalid_request");
    // Неизвестный, но правильно оформленный cursor не выдаётся за начало списка.
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "payments.list",
          operationId: randomUUID(),
          cursor: randomUUID(),
        }),
      ),
    ).toBe("invalid_request");
  });

  test("межсемейная гонка одного operationId применяет только одну команду", async () => {
    const s = await scenario();
    const recipient = await account();
    const operationId = randomUUID();
    const offerId = randomUUID();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const manage = pricing.manage.bind(pricing);
    const gate = vi
      .spyOn(pricing, "manage")
      .mockImplementation(async (actor, input) => {
        entered();
        await resume;
        return manage(actor, input);
      });
    const saving = db.run(() =>
      s.operations.execute(owner, {
        operation: "offers.save",
        operationId,
        value: { id: offerId, name: "Тариф гонки", benefits: ["community"] },
      }),
    );
    try {
      await started;
      expect(
        await s.operations.execute(owner, {
          ...classifyNew(recipient),
          operationId,
        }),
      ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
    } finally {
      release();
      gate.mockRestore();
      await saving;
    }
    expect(await saving).toMatchObject({ ok: true });
    expect(
      asClassification(
        await s.operations.execute(owner, readClassification(recipient)),
      ).value,
    ).toMatchObject({ classification: "unknown" });
  });

  test("конкурентный повтор каталога возвращает один результат и один аудит", async () => {
    const s = await scenario();
    const command = {
      operation: "offers.save",
      operationId: randomUUID(),
      value: {
        id: randomUUID(),
        name: "Повтор тарифа",
        benefits: ["community"],
      },
    };
    const results = await Promise.all([
      s.operations.execute(owner, command),
      s.operations.execute(owner, command),
    ]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toEqual(results[0]);
    expect(
      await db.prisma.billingOffer.findUnique({
        where: { id: command.value.id },
      }),
    ).toMatchObject({ revision: 1 });
    expect(
      await db.prisma.billingOwnerCommand.count({
        where: { actorId: owner, operationId: command.operationId },
      }),
    ).toBe(1);
  });

  test("конкурентный повтор возврата присоединяется к сохранённой попытке без второго Cancel", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const decision = asRefundDecision(
      await s.operations.execute(owner, {
        operation: "refunds.decide",
        operationId: randomUUID(),
        purchaseRef,
        amountKopecks: 30_000,
        basis: "compensation",
        recurring: "keep",
        reason: "Конкурентный повтор",
      }),
    ).value;
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    s.bank.beforeCancelReturn = async () => {
      enter();
      await resume;
    };
    const command = {
      operation: "refunds.execute",
      operationId: randomUUID(),
      decisionRef: decision.decisionRef,
      expectedRevision: 1,
    };
    const first = db.run(() => s.operations.execute(owner, command));
    let repeated: OwnerResult | undefined;
    try {
      await entered;
      repeated = await s.operations.execute(owner, command);
      expect(repeated).toMatchObject({
        ok: true,
        result: {
          outcome: "refundDecision",
          value: { state: "executing", attempt: { state: "sent" } },
        },
      });
    } finally {
      release();
      await first;
    }
    expect(await first).toEqual(repeated);
    expect(s.bank.cancels).toHaveLength(1);
    expect(
      await db.prisma.billingRefund.count({ where: { purchaseRef } }),
    ).toBe(1);
    expect(
      asRefunds(
        await s.operations.execute(owner, {
          operation: "refunds.read",
          operationId: randomUUID(),
          purchaseRef,
        }),
      ).decisions,
    ).toMatchObject([{ state: "executed" }]);
  });

  test.each(["audit", "completion"])(
    "повтор исполненного возврата после отказа %s возвращает результат без второй отправки",
    async (fault) => {
      const s = await scenario();
      const purchaseRef = await s.buy();
      const decision = asRefundDecision(
        await s.operations.execute(owner, {
          operation: "refunds.decide",
          operationId: randomUUID(),
          purchaseRef,
          amountKopecks: 30_000,
          basis: "compensation",
          recurring: "keep",
          reason: "Сбой аудита",
        }),
      ).value;
      const command = {
        operation: "refunds.execute",
        operationId: randomUUID(),
        decisionRef: decision.decisionRef,
        expectedRevision: 1,
      };
      if (fault === "audit")
        await db.prisma
          .$executeRaw`ALTER TABLE billing.owner_commands ADD CONSTRAINT reject_owner_audit CHECK (FALSE) NOT VALID`;
      else
        await db.prisma
          .$executeRaw`ALTER TABLE billing.owner_command_keys ADD CONSTRAINT reject_owner_result CHECK (result IS NULL) NOT VALID`;
      try {
        expect(await s.operations.execute(owner, command)).toMatchObject({
          ok: false,
          error: { code: "dependency_unavailable" },
        });
        expect(s.bank.cancels).toHaveLength(1);
      } finally {
        if (fault === "audit")
          await db.prisma
            .$executeRaw`ALTER TABLE billing.owner_commands DROP CONSTRAINT reject_owner_audit`;
        else
          await db.prisma
            .$executeRaw`ALTER TABLE billing.owner_command_keys DROP CONSTRAINT reject_owner_result`;
      }
      const restored = asRefundDecision(
        await s.operations.execute(owner, command),
      ).value;
      expect(restored).toMatchObject({
        state: "executed",
        attempt: { state: "confirmed" },
      });
      expect(await s.operations.execute(owner, command)).toMatchObject({
        ok: true,
        result: { outcome: "refundDecision", value: restored },
      });
      expect(s.bank.cancels).toHaveLength(1);
      expect(
        await db.prisma.billingRefund.count({ where: { purchaseRef } }),
      ).toBe(1);
      expect(
        await db.prisma.billingOwnerCommand.count({
          where: { actorId: owner, operationId: command.operationId },
        }),
      ).toBe(1);
    },
  );

  test("повтор команды возвращает исходный результат, изменённая нагрузка конфликтует", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const command = {
      operation: "refunds.decide",
      operationId: randomUUID(),
      purchaseRef,
      amountKopecks: 30_000,
      basis: "compensation",
      recurring: "keep",
      reason: "Повторяемое решение",
    } as const;
    const first = asRefundDecision(
      await s.operations.execute(owner, command),
    ).value;
    // Порядок ключей не меняет отпечаток: та же нагрузка узнаётся.
    const repeated = asRefundDecision(
      await s.operations.execute(owner, {
        reason: command.reason,
        recurring: command.recurring,
        basis: command.basis,
        amountKopecks: command.amountKopecks,
        purchaseRef,
        operationId: command.operationId,
        operation: "refunds.decide",
      }),
    ).value;
    expect(repeated.decisionRef).toBe(first.decisionRef);
    expect(
      await db.prisma.billingRefundDecision.count({ where: { purchaseRef } }),
    ).toBe(1);
    // Решение принадлежит своей команде: изменённая сумма того же operationId не переписывает его.
    expect(
      failure(
        await s.operations.execute(owner, {
          ...command,
          amountKopecks: 50_000,
        }),
      ),
    ).toBe("operation_conflict");
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "payments.reconcile",
          operationId: command.operationId,
          purchaseRef,
        }),
      ),
    ).toBe("operation_conflict");
    // Тот же operationId по другому платежу — другая команда, а не повтор этой.
    const other = await scenario();
    const otherPurchaseRef = await other.buy();
    expect(
      failure(
        await other.operations.execute(owner, {
          ...command,
          purchaseRef: otherPurchaseRef,
        }),
      ),
    ).toBe("operation_conflict");
    expect(
      await db.prisma.billingRefundDecision.count({
        where: { purchaseRef: otherPurchaseRef },
      }),
    ).toBe(0);
    expect(
      await db.prisma.billingRefundDecision.count({ where: { purchaseRef } }),
    ).toBe(1);
  });

  test("ручная выдача идёт через preview, продление и отзыв сохраняют другое основание", async () => {
    const s = await scenario();
    const productGrant = await s.lifetimeProductGrant();
    const supportRef = `support-${randomUUID()}`;
    const preview = asGrantPreview(
      await s.operations.execute(owner, {
        operation: "grants.previewBatch",
        operationId: randomUUID(),
        rows: [
          {
            rowKey: "support",
            accountId: s.buyer,
            source: "manual",
            sourceRef: supportRef,
            terms: {
              capabilities: ["support"],
              startsAt: "2030-03-01T00:00:00Z",
              validUntil: "2030-05-01T00:00:00Z",
              reason: "Ручное сопровождение",
            },
          },
          {
            rowKey: "unknown",
            accountId: randomUUID(),
            source: "manual",
            sourceRef: `unknown-${randomUUID()}`,
            terms: {
              capabilities: ["support"],
              startsAt: "2030-03-01T00:00:00Z",
              validUntil: null,
              reason: "Неизвестный Account",
            },
          },
        ],
      }),
    );
    expect(preview.rows.map((row) => row.status)).toEqual([
      "confirmed",
      "not_found",
    ]);
    // Предпросмотр ничего не выдаёт.
    expect(await s.capabilities()).toEqual([
      "community",
      `product:${s.productId}`,
    ]);
    const applied = asGrantBatch(
      await s.operations.execute(owner, {
        operation: "grants.applyBatch",
        operationId: randomUUID(),
        previewRef: preview.previewRef,
        expectedRevision: preview.revision,
        confirmedRows: ["support"],
      }),
    );
    expect(applied.rows).toHaveLength(1);
    expect(await s.capabilities()).toEqual([
      "community",
      `product:${s.productId}`,
      "support",
    ]);
    const support = asGrants(
      await s.operations.execute(owner, {
        operation: "grants.read",
        operationId: randomUUID(),
        accountId: s.buyer,
      }),
    ).value.grants.find((grant) => grant.sourceRef === supportRef);
    if (support === undefined)
      throw new Error("Manual support grant is missing");
    expect(support).toMatchObject({
      source: "manual",
      active: true,
      validUntil: "2030-05-01T00:00:00.000Z",
      revision: 1,
    });
    const extended = asGrant(
      await s.operations.execute(owner, {
        operation: "grants.extend",
        operationId: randomUUID(),
        grantRef: support.grantRef,
        expectedRevision: 1,
        validUntil: "2030-07-01T00:00:00Z",
        reason: "Продление сопровождения",
      }),
    );
    expect(extended).toMatchObject({ grantRef: support.grantRef, revision: 2 });
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "grants.extend",
          operationId: randomUUID(),
          grantRef: support.grantRef,
          expectedRevision: 1,
          validUntil: "2030-08-01T00:00:00Z",
          reason: "Устаревшая revision",
        }),
      ),
    ).toBe("revision_conflict");
    const revoked = asGrant(
      await s.operations.execute(owner, {
        operation: "grants.revoke",
        operationId: randomUUID(),
        grantRef: support.grantRef,
        expectedRevision: 2,
        reason: "Отзыв одного основания",
      }),
    );
    expect(revoked.revision).toBe(3);
    // Отзыв одного основания сохраняет независимое бессрочное право.
    expect(await s.capabilities()).toEqual([
      "community",
      `product:${s.productId}`,
    ]);
    expect(
      await db.prisma.accessGrant.findUniqueOrThrow({
        where: { id: productGrant },
      }),
    ).toMatchObject({ revokedAt: null });
    await s.buy();
    value(await s.payments.recover());
    const paid = await db.prisma.accessGrant.findFirstOrThrow({
      where: { accountId: s.buyer, source: "paid" },
    });
    // Оплаченные права принадлежат billing: ручная правка их не редактирует.
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "grants.extend",
          operationId: randomUUID(),
          grantRef: paid.id,
          expectedRevision: paid.revision,
          validUntil: "2031-01-01T00:00:00Z",
          reason: "Попытка правки оплаченного",
        }),
      ),
    ).toBe("forbidden");
    expect(
      await db.prisma.accessGrant.findUniqueOrThrow({ where: { id: paid.id } }),
    ).toMatchObject({ revision: paid.revision, validUntil: paid.validUntil });
  });

  test("21 a quote accepted before unpublish cannot start a new purchase afterward", async () => {
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
    const consentEvidenceRefs = await s.consentFor(quote.quoteRef, {
      snapshot: quote.snapshot,
    });
    asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.unpublish",
        operationId: randomUUID(),
        id: s.offerId,
        expectedRevision: 2,
      }),
    );
    expect(
      await s.payments.purchase(s.buyer, {
        operationId: randomUUID(),
        quoteRef: quote.quoteRef,
        contactRevision: 1,
        consentEvidenceRefs,
        acknowledgeExistingAccess: false,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await db.prisma.billingPurchase.count({ where: { accountId: s.buyer } }),
    ).toBe(0);
  });
  test("каталог управляется той же поверхностью с проверкой revision", async () => {
    const s = await scenario();
    const offerId = randomUUID();
    const saved = asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: { id: offerId, name: "Материалы", benefits: ["materials"] },
      }),
    );
    expect(saved.value).toEqual({
      id: offerId,
      revision: 1,
      archived: false,
      published: false,
    });
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "offers.archive",
          operationId: randomUUID(),
          id: offerId,
          expectedRevision: 99,
        }),
      ),
    ).toBe("revision_conflict");
    const archived = asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.archive",
        operationId: randomUUID(),
        id: offerId,
        expectedRevision: 1,
      }),
    );
    expect(archived.value).toEqual({
      id: offerId,
      revision: 2,
      archived: true,
      published: false,
    });
    // Неизвестный вариант не выдумывается: включение несуществующего предложения — not_found.
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "offers.publish",
          operationId: randomUUID(),
          id: randomUUID(),
          expectedRevision: 1,
        }),
      ),
    ).toBe("not_found");
    // Архивирование продаваемого предложения не переписывает оплаченные условия и историю.
    const purchaseRef = await s.buy();
    // Выключение обратимо: предложение и его состав не пересоздаются, повторное включение возвращает продажу.
    const offSale = asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.unpublish",
        operationId: randomUUID(),
        id: s.offerId,
        expectedRevision: 2,
      }),
    );
    expect(offSale.value).toEqual({
      id: s.offerId,
      revision: 3,
      archived: false,
      published: false,
    });
    expect(
      value(await s.subscriptions.read(s.buyer)).subscription,
    ).toMatchObject({
      state: "active",
      snapshot: { offer: { id: s.offerId, revision: 2, archived: false } },
    });
    const ownerList = asCatalogOffers(
      await s.operations.execute(owner, {
        operation: "offers.list",
        operationId: randomUUID(),
        limit: 100,
      }),
    );
    expect(ownerList.items.some((item) => item.offer.id === s.offerId)).toBe(
      true,
    );
    const publicList = value(await pricing.offers({ limit: 100 }));
    expect(publicList.items.some((item) => item.offer.id === s.offerId)).toBe(
      false,
    );
    expect(
      await pricing.quote(randomUUID(), {
        operationId: randomUUID(),
        paymentOptionId: s.optionId,
        optionRevision: 1,
      }),
    ).toMatchObject({ error: { code: "not_found" } });
    const restored = asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.publish",
        operationId: randomUUID(),
        id: s.offerId,
        expectedRevision: 3,
      }),
    );
    expect(restored.value).toEqual({
      id: s.offerId,
      revision: 4,
      archived: false,
      published: true,
    });
    const withdrawn = asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.archive",
        operationId: randomUUID(),
        id: s.offerId,
        expectedRevision: 4,
      }),
    );
    // Архив окончателен: он снимает продажу, и ни сохранение, ни включение не возвращают тариф.
    expect(withdrawn.value).toEqual({
      id: s.offerId,
      revision: 5,
      archived: true,
      published: false,
    });
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "offers.save",
          operationId: randomUUID(),
          expectedRevision: 5,
          value: {
            id: s.offerId,
            name: "Материалы и сопровождение",
            benefits: ["materials", "support"],
            coverage: { productIds: [s.productId], materialIds: [] },
          },
        }),
      ),
    ).toBe("not_found");
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "offers.publish",
          operationId: randomUUID(),
          id: s.offerId,
          expectedRevision: 5,
        }),
      ),
    ).toBe("not_found");
    expect(
      await db.prisma.billingOffer.findUniqueOrThrow({
        where: { id: s.offerId },
      }),
    ).toMatchObject({ revision: 5, archived: true, published: false });
    const detail = asPayment(
      await s.operations.execute(owner, {
        operation: "payments.read",
        operationId: randomUUID(),
        purchaseRef,
      }),
    );
    expect(detail.value.snapshot.offer).toMatchObject({
      id: s.offerId,
      revision: 2,
      archived: false,
    });
    expect(
      value(await s.subscriptions.read(s.buyer)).subscription,
    ).toMatchObject({
      state: "active",
      snapshot: { offer: { revision: 2, archived: false } },
    });
  });

  test("сбой записи назначения сообщает assignEnrollment и откатывает все записи Membership", async () => {
    const logged = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const s = await scenario({
        operationsPrisma: {
          ...db.prisma,
          $transaction: (operation) =>
            db.prisma.$transaction((transaction) =>
              operation({
                ...transaction,
                accessReceipt: new Proxy(transaction.accessReceipt, {
                  get(target, property, receiver): unknown {
                    if (property === "create")
                      return async (
                        ...args: Parameters<typeof target.create>
                      ) => {
                        await target.create(...args);
                        // A JavaScript failure leaves SQL valid: swallowing it would commit partial writes.
                        throw new Error(
                          "Synthetic failure after assignment receipt write",
                        );
                      };
                    const value: unknown = Reflect.get(
                      target,
                      property,
                      receiver,
                    );
                    return value;
                  },
                }),
              }),
            ),
        },
      });
      const recipient = await account();
      const command = {
        operation: "enrollments.assign",
        operationId: randomUUID(),
        accountId: recipient,
        tierId: "62000000-0000-4000-8000-000000000624",
        tierRevision: 1,
        origin: "manual",
        sourceRef: randomUUID(),
        terms: {
          startsAt: now.toISOString(),
          endsAt: null,
          endPolicy: "fixed",
        },
        billingRef: null,
        reason: "Проверка сбоя записи назначения",
      };
      expect(await s.operations.execute(owner, command)).toMatchObject({
        ok: false,
        error: { code: "dependency_unavailable" },
      });
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining(
          '"module":"account-rights","operation":"assignEnrollment"',
        ),
      );
      expect(value(await grants.listEnrollments(owner, recipient))).toEqual([]);
      expect(
        value(await grants.listGrants(owner, { accountId: recipient })).grants,
      ).toEqual([]);
      const { operation: _operation, ...assignment } = command;
      expect(
        await grants.readEnrollmentAssignmentReceipt(owner, assignment),
      ).toBe(null);
      expect(
        await db.prisma.accessChange.count({ where: { accountId: recipient } }),
      ).toBe(0);
      expect(
        await db.prisma.billingOwnerCommand.findUnique({
          where: {
            actorId_operationId: {
              actorId: owner,
              operationId: command.operationId,
            },
          },
        }),
      ).toBe(null);
    } finally {
      logged.mockRestore();
    }
  });

  test("откат Billing отменяет назначение тарифа, права и receipt Membership", async () => {
    let assignedBeforeRollback = false;
    const recipient = await account();
    const s = await scenario({
      operationsPrisma: {
        ...db.prisma,
        $transaction: (operation) =>
          db.prisma.$transaction(async (transaction) => {
            await operation(transaction);
            expect(
              await transaction.tariffAssignment.count({
                where: { accountId: recipient },
              }),
            ).toBe(1);
            assignedBeforeRollback = true;
            throw new Error("Synthetic failure before Billing commit");
          }),
      },
    });
    const command = {
      operation: "enrollments.assign",
      operationId: randomUUID(),
      accountId: recipient,
      tierId: "62000000-0000-4000-8000-000000000624",
      tierRevision: 1,
      origin: "manual",
      sourceRef: randomUUID(),
      terms: { startsAt: now.toISOString(), endsAt: null, endPolicy: "fixed" },
      billingRef: null,
      reason: "Проверка общего отката",
    };
    expect(await s.operations.execute(owner, command)).toMatchObject({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
    expect(assignedBeforeRollback).toBe(true);
    expect(value(await grants.listEnrollments(owner, recipient))).toEqual([]);
    expect(
      value(await grants.listGrants(owner, { accountId: recipient })).grants,
    ).toEqual([]);
    const { operation: _operation, ...assignment } = command;
    expect(
      await grants.readEnrollmentAssignmentReceipt(owner, assignment),
    ).toBe(null);
    expect(
      await db.prisma.billingOwnerCommand.findUnique({
        where: {
          actorId_operationId: {
            actorId: owner,
            operationId: command.operationId,
          },
        },
      }),
    ).toBe(null);
    // Повтор после отказа сохраняет исходный operationId и создаёт ровно одно назначение.
    const retry = await scenario();
    expect(
      success(await retry.operations.execute(owner, command)),
    ).toMatchObject({ outcome: "enrollment" });
    expect(value(await grants.listEnrollments(owner, recipient))).toHaveLength(
      1,
    );
  });

  test("параллельные повторы назначения создают одно назначение и сохраняют receipt после архивирования тарифа", async () => {
    const s = await scenario();
    const recipient = await account();
    const tierId = randomUUID();
    asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: tierId,
          name: "Назначаемый тариф",
          benefits: ["materials", "community"],
          availableForAssignment: true,
          coverage: { productIds: [], materialIds: [], wholePlatform: true },
        },
      }),
    );
    const command = {
      operation: "enrollments.assign",
      operationId: randomUUID(),
      accountId: recipient,
      tierId,
      tierRevision: 1,
      origin: "manual",
      sourceRef: randomUUID(),
      terms: { startsAt: now.toISOString(), endsAt: null, endPolicy: "fixed" },
      billingRef: null,
      reason: "Идемпотентное назначение",
    };
    const [first, replay] = await Promise.all([
      s.operations.execute(owner, command),
      s.operations.execute(owner, command),
    ]);
    expect(success(first)).toMatchObject({ outcome: "enrollment" });
    expect(replay).toEqual(first);
    expect(value(await grants.listEnrollments(owner, recipient))).toHaveLength(
      1,
    );
    asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.archive",
        operationId: randomUUID(),
        id: tierId,
        expectedRevision: 1,
      }),
    );
    expect(await s.operations.execute(owner, command)).toEqual(first);
    expect(
      await s.operations.execute(owner, {
        ...command,
        reason: "Другая команда",
      }),
    ).toMatchObject({ ok: false, error: { code: "operation_conflict" } });
  });

  test("course назначается через Billing только текущей привязке Telegram, а receipt сохраняет повтор после перепривязки", async () => {
    const s = await scenario();
    const recipient = await account();
    const identityRef = `verified:${recipient}`;
    await db.prisma.telegramAccountLinkState.create({
      data: {
        accountId: recipient,
        linkRef: randomUUID(),
        revision: 1,
        principalRef: `account:${recipient}`,
        identityRef,
        updatedAt: now,
      },
    });
    const command = {
      operation: "enrollments.assign",
      operationId: randomUUID(),
      accountId: recipient,
      tierId: "62000000-0000-4000-8000-000000000624",
      tierRevision: 1,
      origin: "course",
      sourceRef: randomUUID(),
      courseSource: {
        policyRef: "verified-course",
        verifiedIdentityRef: identityRef,
      },
      terms: { startsAt: now.toISOString(), endsAt: null, endPolicy: "fixed" },
      billingRef: null,
      reason: "Назначение курса подтверждённому участнику",
    };
    const assigned = await s.operations.execute(owner, command);
    expect(success(assigned)).toMatchObject({
      outcome: "enrollment",
      value: { origin: "course" },
    });
    await db.prisma.telegramAccountLinkState.update({
      where: { accountId: recipient },
      data: { identityRef: `changed:${recipient}`, revision: 2 },
    });
    expect(await s.operations.execute(owner, command)).toEqual(assigned);
    expect(
      await s.operations.execute(owner, {
        ...command,
        operationId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, error: { code: "identity_changed" } });
    expect(value(await grants.listEnrollments(owner, recipient))).toHaveLength(
      1,
    );
  });

  test("activationRules.save сохраняет правило, revision и повтор через BillingOperations", async () => {
    const s = await scenario();
    const tier = asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: randomUUID(),
          name: "Курс для активации",
          benefits: [`product:${s.productId}`, "support"],
          benefitPeriods: [{ capability: "support", months: 3 }],
          availableForAssignment: true,
          coverage: { productIds: [s.productId], materialIds: [] },
        },
      }),
    ).value;
    const command = {
      operation: "activationRules.save",
      operationId: randomUUID(),
      reason: "Активация курса",
      value: {
        id: randomUUID(),
        code: randomUUID(),
        name: "Курс",
        tierId: tier.id,
        tierRevision: tier.revision,
        sourceRef: `course:${randomUUID()}`,
        published: true,
        startsAt: now.toISOString(),
        endsAt: null,
      },
    };
    const saved = success(await s.operations.execute(owner, command));
    expect(saved).toMatchObject({
      outcome: "activationRule",
      value: { ...command.value, revision: 1 },
    });
    expect(success(await s.operations.execute(owner, command))).toEqual(saved);
    expect(
      success(
        await s.operations.execute(owner, {
          ...command,
          operationId: randomUUID(),
          expectedRevision: 1,
          value: { ...command.value, name: "Курс после изменения" },
        }),
      ),
    ).toMatchObject({
      outcome: "activationRule",
      value: { revision: 2, name: "Курс после изменения" },
    });
    expect(
      failure(
        await s.operations.execute(owner, {
          ...command,
          operationId: randomUUID(),
          expectedRevision: 1,
        }),
      ),
    ).toBe("revision_conflict");
    expect(
      failure(
        await s.operations.execute(owner, {
          ...command,
          operationId: randomUUID(),
          expectedRevision: 2,
          value: { ...command.value, tierRevision: tier.revision + 1 },
        }),
      ),
    ).toBe("revision_conflict");
    expect(
      failure(
        await s.operations.execute(outsider, {
          ...command,
          operationId: randomUUID(),
        }),
      ),
    ).toBe("forbidden");
    // A receipt failure follows the rule update; the caller's transaction must roll both back.
    await db.prisma.$executeRaw`ALTER TABLE account_rights.access_receipts
      ADD CONSTRAINT reject_receipt_for_rollback CHECK (FALSE) NOT VALID`;
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      expect(
        failure(
          await s.operations.execute(owner, {
            ...command,
            operationId: randomUUID(),
            expectedRevision: 2,
            value: { ...command.value, name: "Изменение должно откатиться" },
          }),
        ),
      ).toBe("dependency_unavailable");
      const logRecord = z
        .object({ module: z.string(), operation: z.string() })
        .loose();
      const failures = errors.mock.calls.flatMap(([line]: unknown[]) => {
        if (typeof line !== "string") return [];
        const record = logRecord.safeParse(JSON.parse(line));
        return record.success ? [record.data] : [];
      });
      expect(
        failures.find((record) => record.module === "account-rights"),
      ).toMatchObject({
        operation: "manageActivationRule",
      });
    } finally {
      errors.mockRestore();
      await db.prisma.$executeRaw`ALTER TABLE account_rights.access_receipts
        DROP CONSTRAINT reject_receipt_for_rollback`;
    }
    const listed = success(
      await s.operations.execute(owner, {
        operation: "activationRules.list",
        operationId: randomUUID(),
      }),
    );
    if (listed.outcome !== "activationRules") throw unexpected(listed);
    expect(
      listed.items.find((rule) => rule.id === command.value.id),
    ).toMatchObject({
      revision: 2,
      tierRevision: 1,
      name: "Курс после изменения",
    });
  });

  test("тариф без состава или с отдельным материалом не назначается, а стартовый тариф назначается сразу", async () => {
    const s = await scenario();
    const recipient = await account();
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "offers.save",
          operationId: randomUUID(),
          value: {
            id: randomUUID(),
            name: "Пустой тариф",
            benefits: ["materials", "community"],
            availableForAssignment: true,
            coverage: { productIds: [], materialIds: [] },
          },
        }),
      ),
    ).toBe("invalid_request");
    // Состав, потерянный в обход каталога, тариф не назначает и к правилу активации не привязывает.
    const course = asCatalog(
      await s.operations.execute(owner, {
        operation: "offers.save",
        operationId: randomUUID(),
        value: {
          id: randomUUID(),
          name: "Курс",
          benefits: ["materials", "community", "support"],
          availableForAssignment: true,
          coverage: { productIds: [s.productId], materialIds: [] },
        },
      }),
    );
    await db.prisma.billingOffer.update({
      where: { id: course.value.id },
      data: { coverage: { productIds: [], materialIds: [] } },
    });
    const terms = {
      startsAt: now.toISOString(),
      endsAt: null,
      endPolicy: "fixed",
    };
    const assign = (tierId: string, tierRevision: number, reason: string) =>
      s.operations.execute(owner, {
        operation: "enrollments.assign",
        operationId: randomUUID(),
        accountId: recipient,
        tierId,
        tierRevision,
        origin: "manual",
        sourceRef: randomUUID(),
        terms,
        billingRef: null,
        reason,
      });
    expect(
      failure(
        await assign(
          course.value.id,
          course.value.revision,
          "Назначение без состава",
        ),
      ),
    ).toBe("state_conflict");
    expect(
      failure(
        await s.operations.execute(owner, {
          operation: "activationRules.save",
          operationId: randomUUID(),
          reason: "Правило без состава",
          value: {
            id: randomUUID(),
            code: randomUUID(),
            name: "Курс",
            tierId: course.value.id,
            tierRevision: course.value.revision,
            sourceRef: `course:${randomUUID()}`,
            published: true,
            startsAt: now.toISOString(),
            endsAt: null,
          },
        }),
      ),
    ).toBe("state_conflict");
    // Отдельный материал, записанный в состав в обход каталога, тариф тоже не назначает.
    await db.prisma.billingOffer.update({
      where: { id: course.value.id },
      data: {
        coverage: { productIds: [s.productId], materialIds: [randomUUID()] },
      },
    });
    expect(
      failure(
        await assign(
          course.value.id,
          course.value.revision,
          "Назначение с отдельным материалом",
        ),
      ),
    ).toBe("state_conflict");
    expect(
      await db.prisma.tariffAssignment.count({
        where: { accountId: recipient },
      }),
    ).toBe(0);
    expect(
      await db.prisma.accessGrant.count({ where: { accountId: recipient } }),
    ).toBe(0);
    // Стартовый тариф (миграции 0063 и 0068) открывает все продукты платформы, включая новые, даёт
    // сопровождение и общую группу и назначается без шага выпуска.
    const starter = await db.prisma.billingOffer.findUniqueOrThrow({
      where: { id: "62000000-0000-4000-8000-000000000624" },
    });
    expect(starter).toMatchObject({
      availableForAssignment: true,
      revision: 1,
      benefits: ["community", "materials", "support"],
      coverage: { productIds: [], materialIds: [], wholePlatform: true },
    });
    expect(
      success(
        await assign(
          starter.id,
          starter.revision,
          "Назначение стартового тарифа",
        ),
      ),
    ).toMatchObject({ outcome: "enrollment" });
    const issued = await db.prisma.accessGrant.findMany({
      where: { accountId: recipient },
    });
    expect(issued.flatMap((grant) => grant.capabilities).sort()).toEqual([
      "community",
      "materials",
      "support",
    ]);
    expect(issued[0]?.coverage).toEqual({
      productIds: [],
      materialIds: [],
      wholePlatform: true,
    });
  });
});
