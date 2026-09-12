import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { localTbankConfig } from "../../src/config/tbank-config.js";
import { createLocalBankDouble } from "../../src/development/bank-double/local-bank-double.js";
import { assembleAccounts, BillingContact } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import { BillingNotices, BillingOperations, BillingPayments, BillingPricing, BillingSubscriptions } from "../../src/modules/billing/index.js";
import type { OwnerResult } from "../../src/modules/billing/domain/owner-operations.js";
import { Tbank, type BankRequest } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { syntheticConsentDocuments } from "./setup/consent-documents.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code); return result.value;
}
function asRefundDecision(result: OwnerResult) {
  if (!result.ok) throw new Error(result.error.code);
  if (result.result.outcome !== "refundDecision") throw new Error(`Unexpected outcome ${result.result.outcome}`);
  return result.result.value;
}
function asRefunds(result: OwnerResult) {
  if (!result.ok) throw new Error(result.error.code);
  if (result.result.outcome !== "refunds") throw new Error(`Unexpected outcome ${result.result.outcome}`);
  return result.result;
}
/** Обязательный адрес стенда: без него сценарий не продолжается на пустой строке. */
function standUrl(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Expected a stand URL");
  return value;
}

const config = localTbankConfig({});
const formOrigin = config.endpoints.formOrigins[0] ?? "";
const documents = syntheticConsentDocuments;

/**
 * Стенд целиком: настоящие facets и PostgreSQL против двойника банка, который живёт в локальном
 * Compose. Нотификация двойника идёт тем же входом приложения, что и банковская, поэтому здесь
 * проверяются именно управляемые исходы стенда, а не выдуманные ответы теста.
 */
describe("локальная продажа через двойника банка (реальный PostgreSQL, двойник стенда)", () => {
  let db: TestDatabase;
  let now = new Date("2030-01-31T10:00:00Z");
  let owner: string;
  let accounts: ReturnType<typeof assembleAccounts>;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let pricing: BillingPricing;
  let contact: BillingContact;
  const codes = new Map<string, string>();

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = randomUUID();
    await db.prisma.account.create({ data: { id: owner, logtoIssuer: "https://identity.example.test", logtoSubject: owner } });
    for (const permission of ["platform:admin", "billing:manage"])
      await db.prisma.accountPermission.create({ data: { accountId: owner, permission } });
    accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-stand-fingerprint-key-000000" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, clock: () => now });
    pricing = new BillingPricing({ prisma: db.prisma, accounts, clock: () => now });
    contact = new BillingContact({ prisma: db.prisma, protection: billingContactProtection(Buffer.alloc(32, 71).toString("base64")),
      documents, now: () => now, sendCode: message => { codes.set(message.challengeRef, message.code); return Promise.resolve(); } });
  });
  afterAll(async () => db.dispose());

  async function scenario() {
    now = new Date("2030-01-31T10:00:00Z");
    for (const stale of await db.prisma.billingSubscription.findMany({ where: { state: { not: "ended" } } }))
      await db.prisma.billingSubscription.update({ where: { id: stale.id }, data: { state: "ended", revision: stale.revision + 1, updatedAt: now } });
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
      value: { id: optionId, offerId, months: 1, priceKopecks: 100_000 } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));

    // Нотификация двойника входит в приложение ровно там же, где банковская: через BillingPayments.
    const delivered: { status: string; accepted: boolean }[] = [];
    // Вход приложения существует раньше самого приложения, как и адрес нотификации у банка.
    const inbox: { payments?: BillingPayments } = {};
    const double = createLocalBankDouble({ config, notify: async (url, payload) => {
      expect(url).toBe(config.notificationUrl);
      const accepted = await inbox.payments?.notification(payload);
      delivered.push({ status: String(payload.Status), accepted: accepted?.ok === true });
    } });
    const request: BankRequest = (url, init) =>
      double.handle(new Request(url, { method: init.method, headers: init.headers, body: init.body }));
    const bank = new Tbank(config, request);
    const payments = new BillingPayments({ prisma: db.prisma, bank, contact, grants, clock: () => now });
    inbox.payments = payments;
    const notices = new BillingNotices({ prisma: db.prisma, clock: () => now });
    const subscriptions = new BillingSubscriptions({ prisma: db.prisma, bank, contact, grants, payments, notices, clock: () => now });
    const operations = new BillingOperations({ prisma: db.prisma, accounts, pricing, payments, subscriptions, grants, bank, clock: () => now });

    /** Владелец выбирает исход на странице двойника — так же, как он делает это в браузере. */
    const choose = async (url: string, outcome: string) => {
      const answer = await double.handle(new Request(url, { method: "POST", body: new URLSearchParams({ outcome }) }));
      expect(answer.status).toBe(303);
      return answer;
    };
    const control = async (values: Record<string, string>) =>
      double.handle(new Request(`${formOrigin}/control`, { method: "POST", body: new URLSearchParams(values) }));

    /** Один путь покупки для обоих продуктов: различаются только вариант оплаты и согласия. */
    async function beginPurchase(option = optionId, accepted: readonly string[] = documents.map(document => document.kind)):
      Promise<{ purchaseRef: string; paymentUrl: string }> {
      const quote = value(await pricing.quote(buyer, { operationId: randomUUID(), paymentOptionId: option, optionRevision: 1 }));
      const consent = await contact.acceptConsents(buyer, { operationId: randomUUID(), contextRef: quote.quoteRef,
        documents: documents.filter(document => accepted.includes(document.kind))
          .map(document => ({ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true })) });
      if (!consent.ok) throw new Error(consent.error.code);
      const purchase = value(await payments.purchase(buyer, { operationId: randomUUID(), quoteRef: quote.quoteRef,
        contactRevision: 1, consentEvidenceRefs: consent.evidenceRefs, acknowledgeExistingAccess: false }));
      expect(purchase.state).toBe("pending");
      return { purchaseRef: purchase.purchaseRef, paymentUrl: standUrl(purchase.paymentUrl) };
    }

    /** Разовая продажа руководства: тот же путь, но согласие на списания она не принимает. */
    async function beginGuidePurchase(): Promise<{ purchaseRef: string; paymentUrl: string; capability: string }> {
      const guideOffer = randomUUID(), guideOption = randomUUID(), capability = `guide:${randomUUID()}`;
      value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save",
        value: { id: guideOffer, name: "Руководство «Стенд»", benefits: [capability], benefitPeriods: [{ capability, months: null }] } }));
      value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save",
        value: { id: guideOption, offerId: guideOffer, mode: "one_time", months: 1, priceKopecks: 290_000 } }));
      value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: guideOffer }));
      return { ...await beginPurchase(guideOption, ["terms"]), capability };
    }
    const capabilities = async () => {
      const resolved = await grants.resolveCapabilities(buyer);
      if (!resolved.ok) throw new Error("resolve");
      return resolved.capabilities.map(item => item.capability).sort();
    };
    const purchaseRow = (purchaseRef: string) => db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchaseRef } });
    return { buyer, payments, subscriptions, operations, delivered, choose, control, beginPurchase, beginGuidePurchase, capabilities, purchaseRow };
  }

  test("оплата на форме стенда выдаёт права, сохраняет привязку и не удваивает выдачу", async () => {
    const s = await scenario();
    const { purchaseRef, paymentUrl } = await s.beginPurchase();
    // Форма принадлежит стенду, а не банку: именно её открывает браузер владельца.
    expect(paymentUrl.startsWith(`${formOrigin}/pay/`)).toBe(true);

    await s.choose(paymentUrl, "confirmed");
    expect(s.delivered).toEqual([{ status: "CONFIRMED", accepted: true }]);
    value(await s.payments.recover());
    expect(await s.capabilities()).toEqual(["materials"]);
    const confirmed = await s.purchaseRow(purchaseRef);
    expect(confirmed).toMatchObject({ state: "confirmed", environment: "local", terminalRef: config.terminalKey });
    // Привязка приехала вместе с подтверждением: продлевать будет чем.
    expect(confirmed.bindingCiphertext).not.toBeNull();
    expect(value(await s.subscriptions.read(s.buyer)).subscription).toMatchObject({ state: "active", paidUntil: "2030-02-28T10:00:00.000Z" });

    // Повторная нотификация — то же событие: второй выдачи прав нет.
    await s.choose(paymentUrl, "repeat");
    value(await s.payments.recover());
    expect(s.delivered).toEqual([{ status: "CONFIRMED", accepted: true }, { status: "CONFIRMED", accepted: true }]);
    expect(await db.prisma.accessGrant.count({ where: { accountId: s.buyer, revokedAt: null } })).toBe(1);
    expect(await db.prisma.billingPurchase.count({ where: { accountId: s.buyer, state: "confirmed" } })).toBe(1);
  });

  test("руководство продаётся тем же контуром и не просит сохранить карту", async () => {
    const s = await scenario();
    const guide = await s.beginGuidePurchase();
    expect(guide.paymentUrl.startsWith(`${formOrigin}/pay/`)).toBe(true);
    await s.choose(guide.paymentUrl, "confirmed");
    value(await s.payments.recover());

    // Купленное руководство открывает и сообщество: стенд воспроизводит тот же состав прав.
    expect(await s.capabilities()).toEqual(["community", guide.capability]);
    const row = await s.purchaseRow(guide.purchaseRef);
    expect(row).toMatchObject({ kind: "one_time", state: "confirmed", environment: "local", subscriptionRef: null });
    // Банк не выдал привязку: разовая покупка её не просила, и продлевать тут нечего.
    expect(row.bindingCiphertext).toBeNull();
    expect(await db.prisma.billingSubscription.count({ where: { accountId: s.buyer } })).toBe(0);
  });

  test("каждый исход формы оставляет попытку в своём состоянии и не открывает доступ", async () => {
    for (const [outcome, state] of [["rejected", "failed"], ["canceled", "failed"],
      ["expired", "failed"], ["unknown", "unknown"]] as const) {
      const s = await scenario();
      const { purchaseRef, paymentUrl } = await s.beginPurchase();
      await s.choose(paymentUrl, outcome);
      value(await s.payments.recover());
      expect(await s.purchaseRow(purchaseRef)).toMatchObject({ state });
      expect(await s.capabilities()).toEqual([]);
      expect(value(await s.subscriptions.read(s.buyer)).subscription).toBeNull();
    }
  });

  test("продление списывает по сохранённой карте, а отказ банка закрывает подписку", async () => {
    const s = await scenario();
    const first = await s.beginPurchase();
    await s.choose(first.paymentUrl, "confirmed");
    value(await s.payments.recover());

    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({ started: 1 });
    value(await s.payments.recover());
    expect(value(await s.subscriptions.read(s.buyer)).subscription).toMatchObject({ state: "active", paidUntil: "2030-03-31T10:00:00.000Z" });
    expect(s.delivered.filter(item => item.status === "CONFIRMED")).toHaveLength(2);

    // Следующее списание владелец заранее объявляет отказом: расписание закрывается без повтора.
    await s.control({ chargeOutcome: "rejected", refundOutcome: "accepted" });
    now = new Date("2030-03-31T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({ started: 1 });
    // Закрытое расписание уходит из кабинета: Account снова свободен для новой покупки.
    expect(value(await s.subscriptions.read(s.buyer)).subscription).toBeNull();
    expect(await db.prisma.billingSubscription.findFirstOrThrow({ where: { accountId: s.buyer } })).toMatchObject({ state: "ended" });
    expect(await db.prisma.billingPurchase.count({ where: { accountId: s.buyer, kind: "renewal", state: "failed" } })).toBe(1);
  });

  test("отмена списаний закрывает расписание, не спрашивая банк", async () => {
    const s = await scenario();
    const first = await s.beginPurchase();
    await s.choose(first.paymentUrl, "confirmed");
    value(await s.payments.recover());
    const active = value(await s.subscriptions.read(s.buyer)).subscription;
    const delivered = s.delivered.length;

    value(await s.subscriptions.cancel(s.buyer, { operationId: randomUUID(), expectedRevision: active?.revision }));
    expect(value(await s.subscriptions.read(s.buyer)).subscription).toMatchObject({ state: "canceled" });
    // Оплаченный срок остаётся, но следующее списание уже не отправляется.
    now = new Date("2030-02-28T10:00:00Z");
    expect(value(await s.payments.renew())).toMatchObject({ started: 0 });
    expect(await db.prisma.billingPurchase.count({ where: { accountId: s.buyer, kind: "renewal" } })).toBe(0);
    expect(s.delivered).toHaveLength(delivered);
  });

  test("смена карты применяется только после подтверждения на форме привязки", async () => {
    const s = await scenario();
    const first = await s.beginPurchase();
    await s.choose(first.paymentUrl, "confirmed");
    value(await s.payments.recover());
    const before = value(await s.subscriptions.read(s.buyer)).subscription;

    const flow = value(await s.subscriptions.changeMethod(s.buyer, { operationId: randomUUID(), expectedRevision: before?.revision ?? 0 }));
    expect(flow.formUrl?.startsWith(`${formOrigin}/card/`)).toBe(true);
    // Пока человек не подтвердил привязку, способ оплаты не меняется.
    expect(value(await s.subscriptions.reconcileMethodFlows())).toMatchObject({ inspected: 1, applied: 0 });

    await s.choose(standUrl(flow.formUrl), "completed");
    expect(value(await s.subscriptions.reconcileMethodFlows())).toMatchObject({ inspected: 1, applied: 1 });
    const after = value(await s.subscriptions.read(s.buyer)).subscription;
    expect(after?.paymentMethod?.methodRef).not.toBe(before?.paymentMethod?.methodRef);
  });

  test("возврат проходит частью и целиком, повтор сверки не возвращает дважды", async () => {
    const s = await scenario();
    const { purchaseRef, paymentUrl } = await s.beginPurchase();
    await s.choose(paymentUrl, "confirmed");
    value(await s.payments.recover());

    const partial = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(),
      purchaseRef, amountKopecks: 40_000, access: "keep", recurring: "keep", reason: "Стенд: частичный возврат" }));
    const partialExecuted = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: partial.decisionRef, expectedRevision: 1 }));
    expect(partialExecuted).toMatchObject({ state: "executed",
      attempt: { state: "confirmed", amountKopecks: 40_000, observedStatus: "PARTIAL_REFUNDED", errorCode: "0" } });

    const rest = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.decide", operationId: randomUUID(),
      purchaseRef, amountKopecks: 60_000, access: "revoke", recurring: "cancel", reason: "Стенд: возврат остатка" }));
    const restExecuted = asRefundDecision(await s.operations.execute(owner, { operation: "refunds.execute", operationId: randomUUID(),
      decisionRef: rest.decisionRef, expectedRevision: 1 }));
    expect(restExecuted).toMatchObject({ state: "executed",
      attempt: { state: "confirmed", amountKopecks: 60_000, observedStatus: "REFUNDED", errorCode: "0" } });

    const totals = asRefunds(await s.operations.execute(owner, { operation: "refunds.read", operationId: randomUUID(), purchaseRef }));
    expect(totals).toMatchObject({ refundedKopecks: 100_000, refundableKopecks: 0 });
    // Сверка незавершённых возвратов ничего не отправляет заново: обе попытки уже подтверждены.
    expect(await s.operations.reconcileRefunds()).toMatchObject({ inspected: 0, settled: 0 });
    value(await s.payments.recover());
    expect(await s.capabilities()).toEqual([]);
    expect(value(await s.subscriptions.read(s.buyer)).subscription).toMatchObject({ state: "canceled" });
  });
});
