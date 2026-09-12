import { randomUUID } from "node:crypto";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleAccounts, BillingContact } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import { BillingNotices, BillingOperations, BillingPayments, BillingPricing, BillingSubscriptions } from "../../src/modules/billing/index.js";
import type { OwnerOutcome, OwnerResult } from "../../src/modules/billing/domain/owner-operations.js";
import { Tbank, tbankToken } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { tbankConfigSchema } from "../../src/config/tbank-config.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
import { syntheticConsentDocuments } from "./setup/consent-documents.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code); return result.value;
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
  if (value.outcome !== "catalog") throw unexpected(value); return value;
}
function asCatalogOffers(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "catalogOffers") throw unexpected(value); return value;
}
function asPayments(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "payments") throw unexpected(value); return value;
}
function asPayment(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "payment") throw unexpected(value); return value;
}
function asReconciled(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "reconciled") throw unexpected(value); return value;
}
function asRefundDecision(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "refundDecision") throw unexpected(value); return value;
}
function asRefunds(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "refunds") throw unexpected(value); return value;
}
function asGrants(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grants") throw unexpected(value); return value;
}
function asGrantPreview(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grantPreview") throw unexpected(value); return value;
}
function asGrantBatch(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grantBatch") throw unexpected(value); return value;
}
function asGrant(result: OwnerResult) {
  const value = success(result);
  if (value.outcome !== "grant") throw unexpected(value); return value;
}

const config = tbankConfigSchema.parse({ environment: "demo", terminalKey: "SYNTHETICOWNER", password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 61).toString("base64"), recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  minimumKopecks: 100, maximumKopecks: 10_000_000, returnUrl: "https://inside.example.test/account",
  notificationUrl: "https://inside.example.test/billing/tbank/notification", receipt: { taxation: "usn_income", tax: "none" } });
const documents = syntheticConsentDocuments;
const requestSchema = z.object({ OrderId: z.string().optional(), PaymentId: z.string().optional(),
  Amount: z.number().optional(), ExternalRequestId: z.string().optional(), Token: z.string() }).loose();
const savedBinding = "synthetic-owner-card";

/** Управляемый банк: возврат отвечает только тем, что задал сценарий, и запоминает каждый запрос. */
class BankFixture {
  readonly orders = new Map<string, { paymentId: string; amount: number; status: string }>();
  readonly cancels: { externalRequestId: string; paymentId: string; amount: number }[] = [];
  private readonly scope = randomUUID();
  failCancel = false; cancelStatus = "REFUNDED"; cancelSucceeds = true;

  event(orderId: string, extra: Record<string, unknown> = {}) {
    const order = this.orders.get(orderId);
    if (!order) throw new Error("Unknown synthetic order");
    return { TerminalKey: config.terminalKey, OrderId: orderId, PaymentId: order.paymentId, Amount: order.amount,
      Status: order.status, Success: true, ErrorCode: "0", ...extra };
  }
  notify(orderId: string, status: string, extra: Record<string, unknown> = {}) {
    const order = this.orders.get(orderId);
    if (order) order.status = status;
    const body = this.event(orderId, { Status: status, ...extra });
    return { ...body, Token: tbankToken(body, config.password) };
  }
  client(): Tbank { return new Tbank(config, (url, init) => Promise.resolve(this.respond(url, init))); }
  private respond(url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): Response {
    if (typeof url !== "string" || typeof init?.body !== "string") throw new Error("Unexpected bank request");
    const body = requestSchema.parse(JSON.parse(init.body));
    if (url.endsWith("/Init")) {
      const orderId = z.string().parse(body.OrderId);
      this.orders.set(orderId, { paymentId: `${this.scope}-${this.orders.size + 1}`, amount: z.number().parse(body.Amount), status: "NEW" });
      return Response.json({ ...this.event(orderId), PaymentURL: "https://securepay.tinkoff.ru/test" });
    }
    if (url.endsWith("/Cancel")) {
      const paymentId = z.string().parse(body.PaymentId);
      const [orderId, order] = this.byPayment(paymentId);
      this.cancels.push({ externalRequestId: z.string().parse(body.ExternalRequestId), paymentId, amount: z.number().parse(body.Amount) });
      if (this.failCancel) throw new Error("Synthetic Cancel timeout after bank acceptance");
      return Response.json({ TerminalKey: config.terminalKey, OrderId: orderId, PaymentId: paymentId,
        Status: this.cancelStatus, Success: this.cancelSucceeds, ErrorCode: this.cancelSucceeds ? "0" : "3007",
        OriginalAmount: order.amount });
    }
    if (url.endsWith("/GetState")) return Response.json(this.event(this.byPayment(z.string().parse(body.PaymentId))[0]));
    if (url.endsWith("/CheckOrder")) {
      const orderId = z.string().parse(body.OrderId);
      const order = this.orders.get(orderId);
      return Response.json({ Success: true, ErrorCode: "0", TerminalKey: config.terminalKey, OrderId: orderId,
        Payments: order ? [{ PaymentId: order.paymentId, Status: order.status, Success: true }] : [] });
    }
    throw new Error(`Unexpected bank method ${url}`);
  }
  private byPayment(paymentId: string): [string, { paymentId: string; amount: number; status: string }] {
    const entry = [...this.orders].find(([, order]) => order.paymentId === paymentId);
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
      await db.prisma.account.create({ data: { id, logtoIssuer: "https://identity.example.test", logtoSubject: id } });
    // Владельческие операции проходят на одном scoped billing:manage: новых ролей задача не создаёт.
    await db.prisma.accountPermission.create({ data: { accountId: owner, permission: "billing:manage" } });
    // Классификация старой подписки принадлежит #404 и остаётся за platform:admin.
    await db.prisma.accountPermission.create({ data: { accountId: administrator, permission: "platform:admin" } });
    await db.prisma.accountPermission.create({ data: { accountId: outsider, permission: "materials:manage" } });
    accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-owner-fingerprint-key-0000000" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, clock: () => now });
    pricing = new BillingPricing({ prisma: db.prisma, accounts, clock: () => now });
    contact = new BillingContact({ prisma: db.prisma, protection: billingContactProtection(Buffer.alloc(32, 62).toString("base64")),
      documents, now: () => now, sendCode: message => { codes.set(message.challengeRef, message.code); return Promise.resolve(); } });
  });
  afterAll(async () => db.dispose());

  const paymentIdOf = async (purchaseRef: string) =>
    (await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchaseRef } })).paymentId;

  async function scenario(options: { readonly benefits?: readonly string[]; readonly priceKopecks?: number } = {}) {
    now = new Date("2030-03-31T10:00:00Z");
    const buyer = randomUUID();
    const guideId = randomUUID();
    await db.prisma.account.create({ data: { id: buyer, logtoIssuer: "https://identity.example.test", logtoSubject: buyer } });
    expect(await grants.classifyLegacy(administrator, { operationId: randomUUID(), accountId: buyer, expectedRevision: 0,
      classification: "confirmed_new", sourceRef: buyer, reason: "Synthetic new buyer", bridgeEnabled: false, tributeStopped: false })).toMatchObject({ ok: true });
    const start = await contact.start(buyer, { operationId: randomUUID(), email: `${buyer}@example.test`, expectedRevision: 0 });
    if (!start.ok) throw new Error(start.error.code);
    expect(await contact.confirm(buyer, { operationId: randomUUID(), challengeRef: start.challengeRef, code: codes.get(start.challengeRef) })).toMatchObject({ ok: true });
    const offerId = randomUUID(), optionId = randomUUID();
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save",
      value: { id: offerId, name: "Материалы и сопровождение", benefits: [...options.benefits ?? ["materials", "support"]] } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save",
      value: { id: optionId, offerId, months: 1, priceKopecks: options.priceKopecks ?? 100_000 } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));
    const bank = new BankFixture();
    const client = bank.client();
    const payments = new BillingPayments({ prisma: db.prisma, bank: client, contact, grants, clock: () => now });
    const notices = new BillingNotices({ prisma: db.prisma, clock: () => now });
    const subscriptions = new BillingSubscriptions({ prisma: db.prisma, bank: client, contact, grants, payments, notices, clock: () => now });
    const operations = new BillingOperations({ prisma: db.prisma, accounts, pricing, payments, subscriptions, grants, bank: client, clock: () => now });

    async function consentFor(contextRef: string) {
      const accepted = await contact.acceptConsents(buyer, { operationId: randomUUID(), contextRef,
        documents: documents.map(document => ({ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true })) });
      if (!accepted.ok) throw new Error(accepted.error.code);
      return accepted.evidenceRefs;
    }
    async function reserve() {
      const quote = value(await pricing.quote(buyer, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 }));
      return value(await payments.purchase(buyer, { operationId: randomUUID(), quoteRef: quote.quoteRef, contactRevision: 1,
        consentEvidenceRefs: await consentFor(quote.quoteRef), acknowledgeExistingAccess: false }));
    }
    async function buy() {
      const purchase = await reserve();
      expect(await payments.notification(bank.notify(purchase.purchaseRef, "AUTHORIZED", { RebillId: savedBinding }))).toMatchObject({ ok: true });
      expect(await payments.notification(bank.notify(purchase.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
      value(await payments.recover());
      return purchase.purchaseRef;
    }
    /** Независимое бессрочное право на руководство: оно не связано с подпиской и её возвратом. */
    async function lifetimeGuideGrant() {
      const preview = asGrantPreview(await operations.execute(owner, { operation: "grants.previewBatch", operationId: randomUUID(),
        rows: [{ rowKey: "guide", accountId: buyer, source: "manual", sourceRef: `guide-${guideId}`,
          terms: { capabilities: [`guide:${guideId}`], startsAt: "2030-01-01T00:00:00Z", validUntil: null, reason: "Курс полностью пройден" } }] }));
      expect(preview.rows).toEqual([{ rowKey: "guide", accountId: buyer, status: "confirmed" }]);
      const applied = asGrantBatch(await operations.execute(owner, { operation: "grants.applyBatch", operationId: randomUUID(),
        previewRef: preview.previewRef, expectedRevision: preview.revision, confirmedRows: ["guide"] }));
      const row = applied.rows[0];
      if (row === undefined || !row.result.ok) throw new Error("Manual guide grant was not applied");
      return row.result.grantRef;
    }
    const capabilities = async () => {
      const resolved = await grants.resolveCapabilities(buyer);
      if (!resolved.ok) throw new Error(resolved.error.code);
      return resolved.capabilities.map(entry => entry.capability);
    };
    return { buyer, guideId, offerId, optionId, bank, payments, subscriptions, operations, buy, reserve, lifetimeGuideGrant, capabilities };
  }

  test("владелец читает платежи, условия и остаток к возврату без банковских секретов", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const page = asPayments(await s.operations.execute(owner, { operation: "payments.list", operationId: randomUUID(), accountId: s.buyer }));
    expect(page).toMatchObject({ nextCursor: null });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ purchaseRef, accountId: s.buyer, kind: "initial", state: "confirmed",
      amountKopecks: 100_000, refundedKopecks: 0, refundableKopecks: 100_000, access: "ready", fiscalization: "pending" });
    const stored = await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchaseRef } });
    const serialized = JSON.stringify(page);
    for (const secret of [savedBinding, `${s.buyer}@example.test`,
      z.object({ emailCiphertext: z.string() }).parse(stored.contact).emailCiphertext,
      z.string().parse(stored.bindingCiphertext)]) expect(serialized).not.toContain(secret);
    const detail = asPayment(await s.operations.execute(owner, { operation: "payments.read", operationId: randomUUID(), purchaseRef }));
    expect(detail.events.map(event => event.kind)).toEqual(["payment_confirmed"]);
    expect(detail.decisions).toEqual([]);
    expect(detail.audit).toEqual([]);
    // Сверка перечитывает банк и не создаёт новый платёж.
    const initCalls = s.bank.orders.size;
    expect(asReconciled(await s.operations.execute(owner, { operation: "payments.reconcile", operationId: randomUUID(), purchaseRef })).value)
      .toMatchObject({ purchaseRef, state: "confirmed" });
    expect(s.bank.orders.size).toBe(initCalls);
    expect(failure(await s.operations.execute(owner, { operation: "payments.read", operationId: randomUUID(), purchaseRef: randomUUID() }))).toBe("not_found");
  });

  test("полный возврат отменяет продление, но сам не отзывает доступ и не трогает бессрочное право", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const guideGrant = await s.lifetimeGuideGrant();
    const decided = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: 100_000, access: "keep", recurring: "cancel", reason: "Обращение в поддержку: полный возврат" })).value;
    expect(decided).toMatchObject({ state: "decided", revision: 1, amountKopecks: 100_000, access: "keep", recurring: "cancel", attempt: null });
    const executed = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: decided.decisionRef, expectedRevision: 1 })).value;
    expect(executed).toMatchObject({ state: "executed", revision: 3,
      attempt: { state: "confirmed", amountKopecks: 100_000, observedStatus: "REFUNDED", errorCode: "0" } });
    const sent = s.bank.cancels;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ externalRequestId: executed.attempt?.refundRef, amount: 100_000 });
    expect(sent[0]?.paymentId).toBe(await paymentIdOf(purchaseRef));
    // Возврат денег не отзывает доступ: это отдельное решение владельца.
    value(await s.payments.recover());
    expect(await s.capabilities()).toEqual([`guide:${s.guideId}`, "materials", "support"]);
    expect(await db.prisma.accessGrant.findUniqueOrThrow({ where: { id: guideGrant } })).toMatchObject({ revokedAt: null, validUntil: null });
    expect(value(await s.subscriptions.read(s.buyer)).subscription).toMatchObject({ state: "canceled", paidUntil: "2030-04-30T10:00:00.000Z" });
    const totals = asRefunds(await s.operations.execute(owner, { operation: "refunds.read", operationId: randomUUID(), purchaseRef }));
    expect(totals).toMatchObject({ refundedKopecks: 100_000, refundableKopecks: 0 });
    expect(totals.decisions).toHaveLength(1);
    expect(failure(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: 100, access: "keep", recurring: "keep", reason: "Повторный возврат сверх суммы" }))).toBe("unsupported_amount");
    const audit = asPayment(await s.operations.execute(owner, { operation: "payments.read", operationId: randomUUID(), purchaseRef })).audit;
    // Каждая применённая команда сохранила исполнителя, основание и результат; секретов в них нет.
    expect(audit.map(entry => entry.operation)).toEqual(["refunds.decide", "refunds.execute"]);
    expect(audit.every(entry => entry.actorId === owner)).toBe(true);
    expect(audit[0]?.reason).toBe("Обращение в поддержку: полный возврат");
    expect(audit[1]?.reason).toBe("Обращение в поддержку: полный возврат");
    expect(JSON.stringify(audit)).not.toContain(savedBinding);
  });

  test("два решения о полном возврате не исполняются дважды: остаток проверяется при отправке", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const decide = async (reason: string) => asRefundDecision(await s.operations.execute(owner, { operation: "refunds.decide",
      operationId: randomUUID(), purchaseRef, amountKopecks: 100_000, access: "keep", recurring: "keep", reason })).value;
    // Решение ничего не резервирует: сумма проверяется в момент отправки под замком платежа.
    const first = await decide("Первое решение о полном возврате");
    const second = await decide("Второе решение о том же платеже");
    expect(asRefundDecision(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: first.decisionRef, expectedRevision: 1 })).value).toMatchObject({ state: "executed" });
    expect(failure(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: second.decisionRef, expectedRevision: 1 }))).toBe("unsupported_amount");
    expect(s.bank.cancels).toHaveLength(1);
    expect(await db.prisma.billingRefund.count({ where: { purchaseRef } })).toBe(1);
    expect(asRefunds(await s.operations.execute(owner, { operation: "refunds.read", operationId: randomUUID(), purchaseRef })))
      .toMatchObject({ refundedKopecks: 100_000, refundableKopecks: 0 });
  });

  test("потерянный ответ банка оставляет возврат неизвестным и сверяется той же попыткой", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const decided = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: 40_000, access: "keep", recurring: "keep", reason: "Частичный возврат за неиспользованный срок" })).value;
    s.bank.failCancel = true;
    const pending = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: decided.decisionRef, expectedRevision: 1 })).value;
    expect(pending).toMatchObject({ state: "executing", attempt: { state: "unknown", observedStatus: "no_response", amountKopecks: 40_000 } });
    // Незавершённый возврат удерживает свою сумму и не разрешает вторую отправку.
    expect(asRefunds(await s.operations.execute(owner, { operation: "refunds.read", operationId: randomUUID(), purchaseRef })))
      .toMatchObject({ refundedKopecks: 0, refundableKopecks: 60_000 });
    expect(failure(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: decided.decisionRef, expectedRevision: 2 }))).toBe("refund_in_progress");
    // Незавершённая попытка одного решения закрывает отправку и по любому другому решению.
    const parallel = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: 10_000, access: "keep", recurring: "keep", reason: "Второе решение при незавершённой попытке" })).value;
    expect(failure(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: parallel.decisionRef, expectedRevision: 1 }))).toBe("refund_in_progress");
    expect(await db.prisma.billingRefund.count({ where: { purchaseRef } })).toBe(1);
    expect(s.bank.cancels).toHaveLength(1);
    s.bank.failCancel = false;
    expect(await s.operations.reconcileRefunds()).toEqual({ inspected: 1, settled: 1 });
    // Повтор с прежним ExternalRequestId банк считает тем же запросом: второй возврат не создаётся.
    expect(s.bank.cancels).toHaveLength(2);
    expect(new Set(s.bank.cancels.map(cancel => cancel.externalRequestId)).size).toBe(1);
    expect(await db.prisma.billingRefund.count({ where: { purchaseRef } })).toBe(1);
    const settled = asRefunds(await s.operations.execute(owner, { operation: "refunds.read", operationId: randomUUID(), purchaseRef }));
    expect(settled).toMatchObject({ refundedKopecks: 40_000, refundableKopecks: 60_000 });
    expect(settled.decisions.find(entry => entry.decisionRef === decided.decisionRef))
      .toMatchObject({ state: "executed", attempt: { state: "confirmed" } });
  });

  test("попытка, оставшаяся отправленной после сбоя процесса, сверяется и не отправляется заново", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const decided = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: 20_000, access: "keep", recurring: "keep", reason: "Возврат с потерей процесса" })).value;
    s.bank.failCancel = true;
    asRefundDecision(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: decided.decisionRef, expectedRevision: 1 }));
    // Сбой между сохранением попытки и ответом банка не успевает записать даже `unknown`.
    const attempt = await db.prisma.billingRefund.findFirstOrThrow({ where: { purchaseRef } });
    await db.prisma.billingRefund.update({ where: { id: attempt.id }, data: { state: "sent", observedStatus: null } });
    s.bank.failCancel = false;
    expect(await s.operations.reconcileRefunds()).toEqual({ inspected: 1, settled: 1 });
    expect(new Set(s.bank.cancels.map(cancel => cancel.externalRequestId))).toEqual(new Set([attempt.id]));
    expect(await db.prisma.billingRefund.count({ where: { purchaseRef } })).toBe(1);
    expect(asRefunds(await s.operations.execute(owner, { operation: "refunds.read", operationId: randomUUID(), purchaseRef })))
      .toMatchObject({ refundedKopecks: 20_000, refundableKopecks: 80_000 });
  });

  test("отзыв доступа исполняется только по подтверждённому возврату и только для оплаченного основания", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const guideGrant = await s.lifetimeGuideGrant();
    const decided = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: 100_000, access: "revoke", recurring: "keep", reason: "Возврат с отзывом оплаченного доступа" })).value;
    s.bank.cancelSucceeds = false;
    s.bank.cancelStatus = "REJECTED";
    const rejected = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: decided.decisionRef, expectedRevision: 1 })).value;
    // Неуспешный возврат не показывается исполненным и ничего не отзывает.
    expect(rejected).toMatchObject({ state: "failed", attempt: { state: "failed", observedStatus: "REJECTED", errorCode: "3007" } });
    value(await s.payments.recover());
    expect(await s.capabilities()).toEqual([`guide:${s.guideId}`, "materials", "support"]);
    expect(asRefunds(await s.operations.execute(owner, { operation: "refunds.read", operationId: randomUUID(), purchaseRef })))
      .toMatchObject({ refundedKopecks: 0, refundableKopecks: 100_000 });
    s.bank.cancelSucceeds = true;
    s.bank.cancelStatus = "REFUNDED";
    const second = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: 100_000, access: "revoke", recurring: "keep", reason: "Возврат подтверждён после исправления" })).value;
    expect(asRefundDecision(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: second.decisionRef, expectedRevision: 1 })).value).toMatchObject({ state: "executed" });
    value(await s.payments.recover());
    // Отзывается ровно оплаченное основание этой покупки; независимое бессрочное право остаётся.
    expect(await s.capabilities()).toEqual([`guide:${s.guideId}`]);
    const paid = await db.prisma.accessGrant.findMany({ where: { accountId: s.buyer, source: "paid" } });
    expect(paid.length).toBeGreaterThan(0);
    expect(paid.every(grant => grant.revokedAt !== null && grant.revision === 2)).toBe(true);
    expect(await db.prisma.accessGrant.findUniqueOrThrow({ where: { id: guideGrant } })).toMatchObject({ revokedAt: null });
    expect(value(await s.subscriptions.read(s.buyer)).subscription).toMatchObject({ state: "active" });
    const history = asGrants(await s.operations.execute(owner, { operation: "grants.read", operationId: randomUUID(), accountId: s.buyer })).value;
    expect(history.history.map(entry => entry.kind)).toContain("paid_revoked");
  });

  test("сумма вне допустимого, неподтверждённый платёж и чужие полномочия отклоняются", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    for (const amountKopecks of [0, -100, 1.5]) {
      expect(failure(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
        amountKopecks, access: "keep", recurring: "keep", reason: "Недопустимая сумма" }))).toBe("invalid_request");
    }
    expect(failure(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: 100_001, access: "keep", recurring: "keep", reason: "Больше оплаченного" }))).toBe("unsupported_amount");
    expect(failure(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef: randomUUID(),
      amountKopecks: 1_000, access: "keep", recurring: "keep", reason: "Неизвестный платёж" }))).toBe("not_found");
    const other = await scenario();
    const prepared = await other.reserve();
    expect(failure(await other.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(), purchaseRef: prepared.purchaseRef,
      amountKopecks: 1_000, access: "keep", recurring: "keep", reason: "Платёж ещё не подтверждён" }))).toBe("state_conflict");
    // Одни полномочия для admin и MCP: и то и другое проходит через этот фасет.
    // platform:admin владельца включает billing:manage, поэтому прежний доступ сохраняется.
    expect(asPayments(await s.operations.execute(administrator, { operation: "payments.list", operationId: randomUUID() })).items.length)
      .toBeGreaterThan(0);
    for (const actor of [outsider, s.buyer])
      expect(failure(await s.operations.execute(actor, { operation: "payments.list", operationId: randomUUID() }))).toBe("forbidden");
    expect(failure(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: randomUUID(), expectedRevision: 1 }))).toBe("not_found");
    expect(failure(await s.operations.execute(owner, { operation: "payments.list", operationId: randomUUID(), cursor: "not-a-cursor" }))).toBe("invalid_request");
    // Неизвестный, но правильно оформленный cursor не выдаётся за начало списка.
    expect(failure(await s.operations.execute(owner, { operation: "payments.list", operationId: randomUUID(), cursor: randomUUID() }))).toBe("invalid_request");
  });

  test("повтор команды возвращает исходный результат, изменённая нагрузка конфликтует", async () => {
    const s = await scenario();
    const purchaseRef = await s.buy();
    const command = { operation: "refunds.decide", operationId: randomUUID(), purchaseRef,
      amountKopecks: 30_000, access: "keep", recurring: "keep", reason: "Повторяемое решение" } as const;
    const first = asRefundDecision(await s.operations.execute(owner, command)).value;
    // Порядок ключей не меняет отпечаток: та же нагрузка узнаётся.
    const repeated = asRefundDecision(await s.operations.execute(owner, { reason: command.reason, recurring: command.recurring,
      access: command.access, amountKopecks: command.amountKopecks, purchaseRef, operationId: command.operationId,
      operation: "refunds.decide" })).value;
    expect(repeated.decisionRef).toBe(first.decisionRef);
    expect(await db.prisma.billingRefundDecision.count({ where: { purchaseRef } })).toBe(1);
    // Решение принадлежит своей команде: изменённая сумма того же operationId не переписывает его.
    expect(failure(await s.operations.execute(owner, { ...command, amountKopecks: 50_000 }))).toBe("operation_conflict");
    expect(failure(await s.operations.execute(owner, { operation: "payments.reconcile", operationId: command.operationId, purchaseRef })))
      .toBe("operation_conflict");
    // Тот же operationId по другому платежу — другая команда, а не повтор этой.
    const other = await scenario();
    const otherPurchaseRef = await other.buy();
    expect(failure(await other.operations.execute(owner, { ...command, purchaseRef: otherPurchaseRef }))).toBe("operation_conflict");
    expect(await db.prisma.billingRefundDecision.count({ where: { purchaseRef: otherPurchaseRef } })).toBe(0);
    expect(await db.prisma.billingRefundDecision.count({ where: { purchaseRef } })).toBe(1);
  });

  test("ручная выдача идёт через preview, продление и отзыв сохраняют другое основание", async () => {
    const s = await scenario();
    const guideGrant = await s.lifetimeGuideGrant();
    const supportRef = `support-${randomUUID()}`;
    const preview = asGrantPreview(await s.operations.execute(owner, { operation: "grants.previewBatch", operationId: randomUUID(),
      rows: [{ rowKey: "support", accountId: s.buyer, source: "manual", sourceRef: supportRef,
        terms: { capabilities: ["support"], startsAt: "2030-03-01T00:00:00Z", validUntil: "2030-05-01T00:00:00Z", reason: "Ручное сопровождение" } },
      { rowKey: "unknown", accountId: randomUUID(), source: "manual", sourceRef: `unknown-${randomUUID()}`,
        terms: { capabilities: ["materials"], startsAt: "2030-03-01T00:00:00Z", validUntil: null, reason: "Неизвестный Account" } }] }));
    expect(preview.rows.map(row => row.status)).toEqual(["confirmed", "not_found"]);
    // Предпросмотр ничего не выдаёт.
    expect(await s.capabilities()).toEqual([`guide:${s.guideId}`]);
    const applied = asGrantBatch(await s.operations.execute(owner, { operation: "grants.applyBatch", operationId: randomUUID(),
      previewRef: preview.previewRef, expectedRevision: preview.revision, confirmedRows: ["support"] }));
    expect(applied.rows).toHaveLength(1);
    expect(await s.capabilities()).toEqual([`guide:${s.guideId}`, "support"]);
    const support = asGrants(await s.operations.execute(owner, { operation: "grants.read", operationId: randomUUID(), accountId: s.buyer })).value
      .grants.find(grant => grant.sourceRef === supportRef);
    if (support === undefined) throw new Error("Manual support grant is missing");
    expect(support).toMatchObject({ source: "manual", active: true, validUntil: "2030-05-01T00:00:00.000Z", revision: 1 });
    const extended = asGrant(await s.operations.execute(owner, { operation: "grants.extend", operationId: randomUUID(),
      grantRef: support.grantRef, expectedRevision: 1, validUntil: "2030-07-01T00:00:00Z", reason: "Продление сопровождения" }));
    expect(extended).toMatchObject({ grantRef: support.grantRef, revision: 2 });
    expect(failure(await s.operations.execute(owner, { operation: "grants.extend", operationId: randomUUID(),
      grantRef: support.grantRef, expectedRevision: 1, validUntil: "2030-08-01T00:00:00Z", reason: "Устаревшая revision" }))).toBe("revision_conflict");
    const revoked = asGrant(await s.operations.execute(owner, { operation: "grants.revoke", operationId: randomUUID(),
      grantRef: support.grantRef, expectedRevision: 2, reason: "Отзыв одного основания" }));
    expect(revoked.revision).toBe(3);
    // Отзыв одного основания сохраняет независимое бессрочное право.
    expect(await s.capabilities()).toEqual([`guide:${s.guideId}`]);
    expect(await db.prisma.accessGrant.findUniqueOrThrow({ where: { id: guideGrant } })).toMatchObject({ revokedAt: null });
    await s.buy();
    value(await s.payments.recover());
    const paid = await db.prisma.accessGrant.findFirstOrThrow({ where: { accountId: s.buyer, source: "paid" } });
    // Оплаченные права принадлежат billing: ручная правка их не редактирует.
    expect(failure(await s.operations.execute(owner, { operation: "grants.extend", operationId: randomUUID(),
      grantRef: paid.id, expectedRevision: paid.revision, validUntil: "2031-01-01T00:00:00Z", reason: "Попытка правки оплаченного" }))).toBe("forbidden");
    expect(await db.prisma.accessGrant.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ revision: paid.revision, validUntil: paid.validUntil });
  });

  test("каталог управляется той же поверхностью с проверкой revision", async () => {
    const s = await scenario();
    const offerId = randomUUID();
    const saved = asCatalog(await s.operations.execute(owner, { operation: "offers.save", operationId: randomUUID(),
      value: { id: offerId, name: "Материалы", benefits: ["materials"] } }));
    expect(saved.value).toEqual({ id: offerId, revision: 1, archived: false, published: false });
    expect(failure(await s.operations.execute(owner, { operation: "offers.archive", operationId: randomUUID(),
      id: offerId, expectedRevision: 99 }))).toBe("revision_conflict");
    const archived = asCatalog(await s.operations.execute(owner, { operation: "offers.archive", operationId: randomUUID(),
      id: offerId, expectedRevision: 1 }));
    expect(archived.value).toEqual({ id: offerId, revision: 2, archived: true, published: false });
    // Неизвестный вариант не выдумывается: включение несуществующего предложения — not_found.
    expect(failure(await s.operations.execute(owner, { operation: "offers.publish", operationId: randomUUID(),
      id: randomUUID(), expectedRevision: 1 }))).toBe("not_found");
    // Архивирование продаваемого предложения не переписывает оплаченные условия и историю.
    const purchaseRef = await s.buy();
    // Выключение обратимо: предложение и его состав не пересоздаются, повторное включение возвращает продажу.
    const offSale = asCatalog(await s.operations.execute(owner, { operation: "offers.unpublish", operationId: randomUUID(),
      id: s.offerId, expectedRevision: 2 }));
    expect(offSale.value).toEqual({ id: s.offerId, revision: 3, archived: false, published: false });
    expect(value(await s.subscriptions.read(s.buyer)).subscription).toMatchObject({ state: "active", snapshot: { offer: { id: s.offerId, revision: 2, archived: false } } });
    const ownerList = asCatalogOffers(await s.operations.execute(owner, { operation: "offers.list", operationId: randomUUID(), limit: 100 }));
    expect(ownerList.items.some((item) => item.offer.id === s.offerId)).toBe(true);
    const publicList = value(await pricing.offers({ limit: 100 }));
    expect(publicList.items.some((item) => item.offer.id === s.offerId)).toBe(false);
    expect(await pricing.quote(randomUUID(), { operationId: randomUUID(), paymentOptionId: s.optionId, optionRevision: 1 }))
      .toMatchObject({ error: { code: "not_found" } });
    const restored = asCatalog(await s.operations.execute(owner, { operation: "offers.publish", operationId: randomUUID(),
      id: s.offerId, expectedRevision: 3 }));
    expect(restored.value).toEqual({ id: s.offerId, revision: 4, archived: false, published: true });
    const withdrawn = asCatalog(await s.operations.execute(owner, { operation: "offers.archive", operationId: randomUUID(),
      id: s.offerId, expectedRevision: 4 }));
    expect(withdrawn.value).toEqual({ id: s.offerId, revision: 5, archived: true, published: true });
    const detail = asPayment(await s.operations.execute(owner, { operation: "payments.read", operationId: randomUUID(), purchaseRef }));
    expect(detail.value.snapshot.offer).toMatchObject({ id: s.offerId, revision: 2, archived: false });
    expect(value(await s.subscriptions.read(s.buyer)).subscription).toMatchObject({ state: "active", snapshot: { offer: { revision: 2, archived: false } } });
  });
});
