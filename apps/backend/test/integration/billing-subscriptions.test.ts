import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleAccounts, BillingContact } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import { BillingNotices, BillingPayments, BillingPricing, BillingSubscriptions } from "../../src/modules/billing/index.js";
import { tbankConfigSchema } from "../../src/config/tbank-config.js";
import { BankFixture } from "./setup/bank.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
import { syntheticConsentDocuments } from "./setup/consent-documents.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code); return result.value;
}
const config = tbankConfigSchema.parse({ environment: "demo", terminalKey: "SYNTHETICLIFECYCLE", password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 51).toString("base64"), recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  cardBinding: { confirmed: true, checkType: "3DS" },
  minimumKopecks: 100, maximumKopecks: 10_000_000, returnUrl: "https://inside.example.test/subscription/return",
  notificationUrl: "https://inside.example.test/billing/tbank/notification", receipt: { taxation: "usn_income", tax: "none" } });
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
    await db.prisma.account.create({ data: { id: owner, logtoIssuer: "https://identity.example.test", logtoSubject: owner } });
    await db.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
    accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-lifecycle-fingerprint-000000" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, clock: () => now });
    pricing = new BillingPricing({ prisma: db.prisma, accounts, clock: () => now });
    contact = new BillingContact({ prisma: db.prisma, protection: billingContactProtection(Buffer.alloc(32, 52).toString("base64")),
      documents, now: () => now, sendCode: message => { codes.set(message.challengeRef, message.code); return Promise.resolve(); } });
  });
  afterAll(async () => db.dispose());

  async function scenario(options: { readonly startedAt?: string; readonly priceKopecks?: number } = {}) {
    now = new Date(options.startedAt ?? "2030-01-31T10:00:00Z");
    // Каждый сценарий владеет своим расписанием: подписки прошлых сценариев закрываются.
    for (const stale of await db.prisma.billingSubscription.findMany({ where: { state: { not: "ended" } } }))
      await db.prisma.billingSubscription.update({ where: { id: stale.id }, data: { state: "ended", revision: stale.revision + 1, updatedAt: now } });
    await db.prisma.billingPurchase.updateMany({ where: { state: { in: ["prepared", "sent", "unknown", "pending", "authorized"] } },
      data: { state: "failed", lifecycleActive: false } });
    await db.prisma.billingPurchase.updateMany({ where: { kind: "initial", lifecycleActive: true }, data: { lifecycleActive: false } });
    const buyer = randomUUID();
    await db.prisma.account.create({ data: { id: buyer, logtoIssuer: "https://identity.example.test", logtoSubject: buyer } });
    expect(await grants.classifyLegacy(owner, { operationId: randomUUID(), accountId: buyer, expectedRevision: 0,
      classification: "confirmed_new", sourceRef: buyer, reason: "Synthetic new buyer", bridgeEnabled: false, tributeStopped: false })).toMatchObject({ ok: true });
    const start = await contact.start(buyer, { operationId: randomUUID(), email: `${buyer}@example.test`, expectedRevision: 0 });
    if (!start.ok) throw new Error(start.error.code);
    expect(await contact.confirm(buyer, { operationId: randomUUID(), challengeRef: start.challengeRef, code: codes.get(start.challengeRef) })).toMatchObject({ ok: true });
    const offerId = randomUUID(), optionId = randomUUID();
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save", value: { id: offerId, name: "Материалы", benefits: ["materials"] } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save",
      value: { id: optionId, offerId, months: 1, priceKopecks: options.priceKopecks ?? 100_000 } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));
    const bank = new BankFixture(config);
    const client = bank.client();
    const payments = new BillingPayments({ prisma: db.prisma, bank: client, contact, grants, clock: () => now });
    const notices = new BillingNotices({ prisma: db.prisma, clock: () => now });
    const subscriptions = new BillingSubscriptions({ prisma: db.prisma, bank: client, contact, grants, payments, notices, clock: () => now });

    async function consentFor(contextRef: string) {
      const accepted = await contact.acceptConsents(buyer, { operationId: randomUUID(), contextRef,
        documents: documents.map(document => ({ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true })) });
      if (!accepted.ok) throw new Error(accepted.error.code);
      return accepted.evidenceRefs;
    }
    async function buy() {
      const quote = value(await pricing.quote(buyer, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 }));
      const purchase = value(await payments.purchase(buyer, { operationId: randomUUID(), quoteRef: quote.quoteRef, contactRevision: 1,
        consentEvidenceRefs: await consentFor(quote.quoteRef), acknowledgeExistingAccess: false }));
      expect(await payments.notification(bank.notify(purchase.purchaseRef, "AUTHORIZED", { RebillId: "synthetic-first-card" }))).toMatchObject({ ok: true });
      expect(await payments.notification(bank.notify(purchase.purchaseRef, "CONFIRMED"))).toMatchObject({ ok: true });
      value(await payments.recover());
      return purchase.purchaseRef;
    }
    async function offer(name: string, benefits: readonly string[], months: number, priceKopecks: number) {
      const nextOfferId = randomUUID(), nextOptionId = randomUUID();
      value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save", value: { id: nextOfferId, name, benefits: [...benefits] } }));
      value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save",
        value: { id: nextOptionId, offerId: nextOfferId, months, priceKopecks } }));
      value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: nextOfferId }));
      return nextOptionId;
    }
    const view = async () => value(await subscriptions.read(buyer)).subscription;
    return { buyer, offerId, optionId, bank, payments, subscriptions, buy, offer, view, consentFor };
  }

  test("кабинет показывает собственные основания доступа и историю списаний без операторских полей", async () => {
    const s = await scenario();
    const empty = value(await s.subscriptions.read(s.buyer));
    expect(empty).toMatchObject({ subscription: null, grounds: [], payments: [] });

    const purchaseRef = await s.buy();
    const cabinet = value(await s.subscriptions.read(s.buyer));
    expect(cabinet.grounds).toEqual([
      { source: "paid", capabilities: ["materials"], startsAt: "2030-01-31T10:00:00.000Z",
        validUntil: "2030-02-28T10:00:00.000Z", active: true },
    ]);
    expect(cabinet.payments).toEqual([
      { purchaseRef, kind: "initial", state: "confirmed", amountKopecks: 100_000, offerName: "Материалы",
        months: 1, fiscalization: "pending", confirmedAt: "2030-01-31T10:00:00.000Z",
        periodEndsAt: "2030-02-28T10:00:00.000Z", createdAt: "2030-01-31T10:00:00.000Z" },
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
    const row = { rowKey: "row-1", accountId: s.buyer, source: "manual" as const, sourceRef: randomUUID(),
      terms: { capabilities: ["materials" as const], startsAt: "2030-01-01T00:00:00.000Z", validUntil: null,
        reason: "Ручная выдача для проверки" } };
    const preview = await grants.previewBatch(owner, { operationId: randomUUID(), rows: [row] });
    if (!preview.ok) throw new Error(preview.error.code);
    const applied = await grants.applyBatch(owner, { operationId: randomUUID(), previewRef: preview.previewRef,
      expectedRevision: preview.revision, confirmedRows: ["row-1"] });
    if (!applied.ok) throw new Error(applied.error.code);
    const withManual = value(await s.subscriptions.read(s.buyer));
    expect(withManual.grounds.map(ground => ground.source).sort()).toEqual(["manual", "paid"]);

    // Оплаченное основание отзывается только подтверждённым возвратом, поэтому владелец
    // отзывает ручное: независимость оснований видна в допустимом направлении.
    const paid = await db.prisma.accessGrant.findFirstOrThrow({ where: { accountId: s.buyer, source: "paid" } });
    expect(await grants.changeGrant(owner, { operationId: randomUUID(), action: "revoke", grantRef: paid.id,
      expectedRevision: paid.revision, reason: "Проверка отзыва" })).toMatchObject({ ok: false, error: { code: "forbidden" } });

    const manual = await db.prisma.accessGrant.findFirstOrThrow({ where: { accountId: s.buyer, source: "manual" } });
    const revoked = await grants.changeGrant(owner, { operationId: randomUUID(), action: "revoke", grantRef: manual.id,
      expectedRevision: manual.revision, reason: "Проверка отзыва" });
    if (!revoked.ok) throw new Error(revoked.error.code);
    expect(value(await s.subscriptions.read(s.buyer)).grounds).toEqual([
      { source: "paid", capabilities: ["materials"], startsAt: "2030-01-31T10:00:00.000Z",
        validUntil: "2030-02-28T10:00:00.000Z", active: true },
    ]);
  });

  test("продление считает срок от исходного anchor и продолжает права без перерыва", async () => {
    const s = await scenario();
    await s.buy();
    expect(await s.view()).toMatchObject({ state: "active", paidUntil: "2030-02-28T10:00:00.000Z", periodIndex: 1 });
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({ inspected: 1, started: 1, blocked: 0 });
    expect(await s.view()).toMatchObject({ state: "active", periodIndex: 2,
      periodStartsAt: "2030-02-28T10:00:00.000Z", paidUntil: "2030-03-31T10:00:00.000Z" });
    expect(s.bank.chargeCalls).toBe(1);
    value(await s.payments.recover());
    const saved = await db.prisma.accessGrant.findMany({ where: { accountId: s.buyer }, orderBy: { startsAt: "asc" } });
    expect(saved).toHaveLength(2);
    expect(saved[1]?.startsAt.toISOString()).toBe("2030-02-28T10:00:00.000Z");
    expect(saved[1]?.validUntil?.toISOString()).toBe("2030-03-31T10:00:00.000Z");
    // Повторный проход не создаёт вторую попытку того же периода.
    expect(value(await s.payments.renew())).toMatchObject({ started: 0 });
    expect(s.bank.chargeCalls).toBe(1);
  });

  test("отмена до отправки запрещает вызов банка и сохраняет оплаченный срок", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const canceled = value(await s.subscriptions.cancel(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision }));
    expect(canceled).toMatchObject({ state: "canceled", paidUntil: "2030-02-28T10:00:00.000Z", inFlightPayment: null });
    const initBefore = s.bank.initCalls;
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({ inspected: 0, started: 0, closed: 1 });
    expect(s.bank.initCalls).toBe(initBefore);
    expect(s.bank.chargeCalls).toBe(0);
    expect(await s.view()).toBeNull();
    // Освободившееся место позволяет вернуться новой покупкой, а не воскрешением прежней.
    now = new Date("2030-04-05T09:00:00Z");
    await s.buy();
    expect(await s.view()).toMatchObject({ state: "active", periodIndex: 1, paidUntil: "2030-05-05T09:00:00.000Z" });
  });

  test("отмена после отправки сверяет прежнюю попытку: поздний успех даёт период без новых списаний", async () => {
    const s = await scenario();
    await s.buy();
    now = new Date("2030-02-28T10:00:00Z");
    s.bank.failCharge = true;
    value(await s.payments.renew());
    const pending = await s.view();
    expect(pending?.inFlightPayment).toMatchObject({ kind: "renewal", state: "unknown" });
    const canceled = value(await s.subscriptions.cancel(s.buyer, { operationId: randomUUID(), expectedRevision: pending?.revision }));
    expect(canceled.state).toBe("canceled");
    expect(canceled.inFlightPayment).not.toBeNull();
    s.bank.failCharge = false;
    const attemptRef = pending?.inFlightPayment?.attemptRef;
    if (!attemptRef) throw new Error("Missing synthetic renewal attempt");
    s.bank.settle(attemptRef, "CONFIRMED");
    expect(await s.payments.reconcile(attemptRef)).toMatchObject({ ok: true });
    expect(await s.view()).toMatchObject({ state: "canceled", periodIndex: 2, paidUntil: "2030-03-31T10:00:00.000Z", inFlightPayment: null });
    // Сверка не повторяет Charge и не запускает следующее списание.
    expect(s.bank.chargeCalls).toBe(1);
    now = new Date("2030-03-31T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({ inspected: 0, started: 0 });
    expect(s.bank.chargeCalls).toBe(1);
  });

  test("повышение доплачивает остаток срока, а понижение и другая длительность ждут следующего периода", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const higher = await s.offer("Материалы и сопровождение", ["materials", "support"], 1, 350_000);
    now = new Date("2030-01-16T12:00:00Z");
    const active = await s.view();
    const quoted = value(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, paymentOptionId: higher }));
    expect(quoted.plan).toMatchObject({ kind: "upgrade", topUpKopecks: 125_000 });
    const applied = value(await s.subscriptions.change(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, changeQuoteRef: quoted.changeQuoteRef }));
    const attemptRef = applied.payment?.purchaseRef;
    if (!attemptRef) throw new Error("Upgrade payment attempt is missing");
    expect(await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: attemptRef } })).toMatchObject({ kind: "upgrade", amountKopecks: 125_000n });
    expect(await s.payments.notification(s.bank.notify(attemptRef, "CONFIRMED"))).toMatchObject({ ok: true });
    const upgraded = await s.view();
    expect(upgraded).toMatchObject({ paidUntil: "2030-02-01T00:00:00.000Z", periodAmountKopecks: 350_000 });
    expect(upgraded?.snapshot.offer.benefits).toEqual(["materials", "support"]);
    value(await s.payments.recover());
    expect(await db.prisma.accessGrant.count({ where: { accountId: s.buyer, capabilities: { has: "support" } } })).toBe(1);
    const yearly = await s.offer("Материалы на год", ["materials"], 12, 900_000);
    const scheduled = value(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: upgraded?.revision, paymentOptionId: yearly }));
    expect(scheduled.plan).toMatchObject({ kind: "scheduled", effectiveAt: "2030-02-01T00:00:00.000Z" });
    const pending = value(await s.subscriptions.change(s.buyer, { operationId: randomUUID(), expectedRevision: upgraded?.revision, changeQuoteRef: scheduled.changeQuoteRef }));
    expect(pending.payment).toBeNull();
    expect(pending.subscription.pendingChange?.snapshot.paymentOption.months).toBe(12);
    const dropped = value(await s.subscriptions.cancelChange(s.buyer, { operationId: randomUUID(), expectedRevision: pending.subscription.revision }));
    expect(dropped.pendingChange).toBeNull();
  });

  test("принятая доплата не пересчитывается временем, а изменившиеся условия отклоняются", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const higher = await s.offer("Материалы и сопровождение", ["materials", "support"], 1, 350_000);
    now = new Date("2030-01-16T12:00:00Z");
    const active = await s.view();
    const quoted = value(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, paymentOptionId: higher }));
    expect(quoted.plan).toMatchObject({ kind: "upgrade", topUpKopecks: 125_000 });
    now = new Date("2030-01-16T12:10:00Z");
    const applied = value(await s.subscriptions.change(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, changeQuoteRef: quoted.changeQuoteRef }));
    const attemptRef = applied.payment?.purchaseRef;
    if (!attemptRef) throw new Error("Upgrade payment attempt is missing");
    expect((await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: attemptRef } })).amountKopecks).toBe(125_000n);

    const other = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await other.buy();
    const target = await other.offer("Материалы и сопровождение", ["materials", "support"], 1, 350_000);
    now = new Date("2030-01-16T12:00:00Z");
    const before = await other.view();
    const stale = value(await other.subscriptions.quoteChange(other.buyer, { operationId: randomUUID(), expectedRevision: before?.revision, paymentOptionId: target }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", expectedRevision: 1,
      value: { id: target, offerId: stale.plan.snapshot.offer.id, months: 1, priceKopecks: 400_000 } }));
    expect(await other.subscriptions.change(other.buyer, { operationId: randomUUID(), expectedRevision: before?.revision, changeQuoteRef: stale.changeQuoteRef }))
      .toMatchObject({ error: { code: "quote_changed" } });
  });

  test("второе повышение считается от цены действующего варианта, а не от первой оплаты", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z", priceKopecks: 100_000 });
    await s.buy();
    const higher = await s.offer("Материалы и сопровождение", ["materials", "support"], 1, 350_000);
    now = new Date("2030-01-16T12:00:00Z");
    const active = await s.view();
    const first = value(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, paymentOptionId: higher }));
    const applied = value(await s.subscriptions.change(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, changeQuoteRef: first.changeQuoteRef }));
    const attemptRef = applied.payment?.purchaseRef;
    if (!attemptRef) throw new Error("Upgrade payment attempt is missing");
    expect(await s.payments.notification(s.bank.notify(attemptRef, "CONFIRMED"))).toMatchObject({ ok: true });
    const upgraded = await s.view();
    expect(upgraded?.periodAmountKopecks).toBe(350_000);
    // Три четверти месяца позади: остаток при переходе 3 500 ₽ → 5 000 ₽ стоит 375 ₽.
    const top = await s.offer("Материалы, сопровождение и разбор", ["materials", "support", "community"], 1, 500_000);
    now = new Date("2030-01-24T06:00:00Z");
    const second = value(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: upgraded?.revision, paymentOptionId: top }));
    expect(second.plan).toMatchObject({ kind: "upgrade", topUpKopecks: 37_500 });
  });

  test("повышение доступно внутри отменённого оплаченного срока, а запланированное изменение — нет", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const higher = await s.offer("Материалы и сопровождение", ["materials", "support"], 1, 350_000);
    const cheaper = await s.offer("Материалы, короткий доступ", ["materials"], 1, 70_000);
    now = new Date("2030-01-16T12:00:00Z");
    const active = await s.view();
    const canceled = value(await s.subscriptions.cancel(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision }));
    expect(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: canceled.revision, paymentOptionId: cheaper }))
      .toMatchObject({ error: { code: "revision_conflict" } });
    const quoted = value(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: canceled.revision, paymentOptionId: higher }));
    const applied = value(await s.subscriptions.change(s.buyer, { operationId: randomUUID(), expectedRevision: canceled.revision, changeQuoteRef: quoted.changeQuoteRef }));
    const attemptRef = applied.payment?.purchaseRef;
    if (!attemptRef) throw new Error("Upgrade payment attempt is missing");
    expect(await s.payments.notification(s.bank.notify(attemptRef, "CONFIRMED"))).toMatchObject({ ok: true });
    const upgraded = await s.view();
    expect(upgraded).toMatchObject({ state: "canceled", periodAmountKopecks: 350_000, paidUntil: "2030-02-01T00:00:00.000Z" });
  });

  test("потерянный ответ Init завершает ту же попытку через CheckOrder и GetState", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    now = new Date("2030-02-01T00:00:00Z");
    s.bank.failInit = true;
    value(await s.payments.renew());
    const pending = await s.view();
    const attemptRef = pending?.inFlightPayment?.attemptRef;
    if (!attemptRef) throw new Error("Missing synthetic renewal attempt");
    expect(pending?.inFlightPayment).toMatchObject({ kind: "renewal", state: "unknown" });
    expect((await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: attemptRef } })).chargeCalled).toBe(false);
    expect(s.bank.chargeCalls).toBe(0);
    s.bank.failInit = false;
    expect(await s.payments.reconcile(attemptRef)).toMatchObject({ ok: true });
    expect(s.bank.initCalls).toBe(2);
    expect(s.bank.chargeCalls).toBe(1);
    expect(await s.view()).toMatchObject({ state: "active", periodIndex: 2, paidUntil: "2030-03-01T00:00:00.000Z" });
  });

  test("отправленное продление не даёт согласовать другое изменение того же периода", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const cheaper = await s.offer("Материалы, короткий доступ", ["materials"], 1, 70_000);
    now = new Date("2030-02-01T00:00:00Z");
    s.bank.failCharge = true;
    value(await s.payments.renew());
    const pending = await s.view();
    expect(pending?.inFlightPayment).toMatchObject({ kind: "renewal", state: "unknown" });
    const quoted = value(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: pending?.revision, paymentOptionId: cheaper }));
    expect(await s.subscriptions.change(s.buyer, { operationId: randomUUID(), expectedRevision: pending?.revision, changeQuoteRef: quoted.changeQuoteRef }))
      .toMatchObject({ error: { code: "payment_in_progress" } });
  });

  test("согласованное изменение применяется следующим периодом по сохранённым условиям", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const cheaper = await s.offer("Материалы, короткий доступ", ["materials"], 1, 70_000);
    const active = await s.view();
    const quoted = value(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, paymentOptionId: cheaper }));
    expect(quoted.plan.kind).toBe("scheduled");
    value(await s.subscriptions.change(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, changeQuoteRef: quoted.changeQuoteRef }));
    now = new Date("2030-02-01T00:00:00Z");
    value(await s.payments.renew());
    const renewed = await s.view();
    expect(renewed).toMatchObject({ periodIndex: 2, periodAmountKopecks: 70_000, pendingChange: null });
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
    expect(value(await s.payments.renew())).toMatchObject({ inspected: 0, started: 0 });
    now = new Date("2030-03-10T08:30:00Z");
    s.bank.chargeOutcome = "CONFIRMED";
    await s.buy();
    expect(await s.view()).toMatchObject({ state: "active", periodIndex: 1,
      periodStartsAt: "2030-03-10T08:30:00.000Z", paidUntil: "2030-04-10T08:30:00.000Z" });
  });

  test("смена карты применяется доказанным token и не включает отменённое продление", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const canceled = value(await s.subscriptions.cancel(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision }));
    const started = value(await s.subscriptions.changeMethod(s.buyer, { operationId: randomUUID(), expectedRevision: canceled.revision }));
    expect(started).toMatchObject({ state: "started", formUrl: "https://securepay.tinkoff.ru/binding" });
    s.bank.binding = { status: "3DS_CHECKING", success: true, rebillId: undefined };
    expect(value(await s.subscriptions.reconcileMethodFlows())).toMatchObject({ inspected: 1, applied: 0 });
    expect((await s.view())?.paymentMethod?.methodRef).toBe(active?.paymentMethod?.methodRef);
    s.bank.binding = { status: "COMPLETED", success: true, rebillId: "synthetic-new-card" };
    expect(value(await s.subscriptions.reconcileMethodFlows())).toMatchObject({ inspected: 1, applied: 1 });
    const changed = await s.view();
    expect(changed?.state).toBe("canceled");
    expect(changed?.paymentMethod?.methodRef).toBe(started.flowRef);
    expect(changed?.pendingMethodChange).toBeNull();
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({ inspected: 0, started: 0 });
    expect(s.bank.chargeCalls).toBe(0);
  });

  test("отозванная привязка закрывает новые отправки и завершает расписание", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const methodRef = active?.paymentMethod?.methodRef;
    expect(await s.subscriptions.revokeMethod(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, paymentMethodRef: randomUUID() }))
      .toMatchObject({ error: { code: "not_found" } });
    const revoked = value(await s.subscriptions.revokeMethod(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, paymentMethodRef: methodRef }));
    expect(revoked.paymentMethod).toMatchObject({ methodRef, revoked: true });
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({ inspected: 1, started: 0, blocked: 0 });
    expect(s.bank.initCalls).toBe(1);
    expect(await s.view()).toBeNull();
  });

  test("конкурирующие продление, повышение и отмена не создают два платежа", async () => {
    const s = await scenario({ startedAt: "2030-01-01T00:00:00Z" });
    await s.buy();
    const higher = await s.offer("Материалы и сопровождение", ["materials", "support"], 1, 350_000);
    now = new Date("2030-02-01T00:00:00Z");
    const active = await s.view();
    const quoted = value(await s.subscriptions.quoteChange(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, paymentOptionId: higher }));
    const chargesBefore = s.bank.chargeCalls;
    const results = await Promise.all([
      s.payments.renew(),
      s.subscriptions.change(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision, changeQuoteRef: quoted.changeQuoteRef }),
      s.subscriptions.cancel(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision }),
    ]);
    expect(results.some(result => result.ok)).toBe(true);
    expect(await db.prisma.billingPurchase.count({ where: { accountId: s.buyer, kind: { not: "initial" } } })).toBeLessThanOrEqual(1);
    expect(s.bank.chargeCalls - chargesBefore).toBeLessThanOrEqual(1);
  });

  test("повтор operationId возвращает исходный результат, чужая нагрузка конфликтует", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const operationId = randomUUID();
    const first = value(await s.subscriptions.cancel(s.buyer, { operationId, expectedRevision: active?.revision }));
    expect(value(await s.subscriptions.cancel(s.buyer, { operationId, expectedRevision: active?.revision }))).toEqual(first);
    expect(await s.subscriptions.cancel(s.buyer, { operationId, expectedRevision: first.revision })).toMatchObject({ error: { code: "operation_conflict" } });
    expect(await s.subscriptions.cancel(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision })).toMatchObject({ error: { code: "revision_conflict" } });
  });

  test("возобновление требует явного согласия и действует только внутри оплаченного срока", async () => {
    const s = await scenario();
    await s.buy();
    const active = await s.view();
    const canceled = value(await s.subscriptions.cancel(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision }));
    expect(await s.subscriptions.resume(s.buyer, { operationId: randomUUID(), expectedRevision: canceled.revision, consentEvidenceRefs: [randomUUID()] }))
      .toMatchObject({ error: { code: "consent_required" } });
    const operationId = randomUUID();
    const resumed = value(await s.subscriptions.resume(s.buyer, { operationId, expectedRevision: canceled.revision,
      consentEvidenceRefs: await s.consentFor(operationId) }));
    expect(resumed).toMatchObject({ state: "active" });
    now = new Date("2030-02-28T10:00:00Z");
    value(await s.payments.renew());
    expect((await s.view())?.periodIndex).toBe(2);
  });
});
