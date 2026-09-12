import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { assembleAccounts, BillingContact } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import { BillingPayments, BillingPricing } from "../../src/modules/billing/index.js";
import { Tbank, tbankToken } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
import { syntheticConsentDocument, syntheticConsentDocuments } from "./setup/consent-documents.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code); return result.value;
}
function code(result: { ok: true } | { ok: false; error: { code: string } }): string {
  if (result.ok) throw new Error("Expected a refusal"); return result.error.code;
}
const config = syntheticTbankConfig({ environment: "demo", terminalKey: "SYNTHETICDEMO", password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 43).toString("base64"), recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  minimumKopecks: 100, maximumKopecks: 1_000_000, returnUrl: "https://inside.example.test/account", notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" } });
const documents = [
  ...syntheticConsentDocuments,
  syntheticConsentDocument("personal_data"),
];
const guidePrice = 290_000;

describe("one-time guide purchase (real PostgreSQL and real facets; synthetic bank and email only)", () => {
  let db: TestDatabase;
  let now = new Date("2030-01-31T10:00:00Z");
  let owner: string;
  let pricing: BillingPricing;
  let grants: ReturnType<typeof assembleAccessGrants>;
  let contact: BillingContact;
  const codes = new Map<string, string>();

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = randomUUID();
    await db.prisma.account.create({ data: { id: owner, logtoIssuer: "https://identity.example.test", logtoSubject: owner } });
    await db.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
    const accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-billing-fingerprint-key-000000" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, clock: () => now });
    pricing = new BillingPricing({ prisma: db.prisma, accounts, clock: () => now });
    contact = new BillingContact({ prisma: db.prisma, protection: billingContactProtection(Buffer.alloc(32, 42).toString("base64")),
      documents, now: () => now, sendCode: message => { codes.set(message.challengeRef, message.code); return Promise.resolve(); } });
  });
  afterAll(async () => db.dispose());

  /** Одно руководство с ценой в каталоге оплаты и покупатель с подтверждённым контактом. */
  async function scenario(options: { readonly benefitPeriods?: { capability: string; months: number | null }[]; readonly term?: number } = {}) {
    now = new Date("2030-01-31T10:00:00Z");
    const buyer = randomUUID();
    await db.prisma.account.create({ data: { id: buyer, logtoIssuer: "https://identity.example.test", logtoSubject: buyer } });
    const start = await contact.start(buyer, { operationId: randomUUID(), email: `${buyer}@example.test`, expectedRevision: 0 });
    if (!start.ok) throw new Error(start.error.code);
    if (!(await contact.confirm(buyer, { operationId: randomUUID(), challengeRef: start.challengeRef, code: codes.get(start.challengeRef) })).ok) throw new Error("contact");
    const guideId = randomUUID();
    const capability = `guide:${guideId}`;
    const offerId = randomUUID(), optionId = randomUUID();
    // Владелец заводит цену руководства там же, где варианты подписки. Бессрочное право — явный срок.
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save", value: {
      id: offerId, name: "Руководство «Синтетика»", benefits: [capability],
      benefitPeriods: options.benefitPeriods ?? [{ capability, months: options.term ?? null }] } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", value: {
      id: optionId, offerId, mode: "one_time", months: 1, priceKopecks: guidePrice } }));
    // Разовая продажа подчиняется тому же тумблеру, что и подписка: пока предложение выключено,
    // руководство не продаётся.
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));

    let orderId = "";
    let status = "NEW";
    const requests: Record<string, unknown>[] = [];
    // Каждая попытка — свой платёж банка: терминал не сопоставляет два заказа одному PaymentId.
    let paymentId = String(Math.floor(Math.random() * 1_000_000_000));
    // Банк отвечает про ту сумму, которую у него запросили: сверка отвергает чужую.
    let amountKopecks = guidePrice;
    const event = (state: string, extra = {}) => ({ TerminalKey: config.terminalKey, OrderId: orderId, PaymentId: paymentId,
      Amount: amountKopecks, Status: state, Success: true, ErrorCode: "0", ...extra });
    const bank = new Tbank(config, (url, init) => {
      if (typeof init?.body !== "string" || typeof url !== "string") throw new Error("Unexpected bank request");
      const body = z.object({ OrderId: z.string().optional(), Amount: z.number().optional(), Token: z.string() }).loose().parse(JSON.parse(init.body));
      if (url.endsWith("/Init")) {
        requests.push(body); orderId = z.string().parse(body.OrderId);
        amountKopecks = z.number().parse(body.Amount);
        paymentId = String(Number(paymentId) + 1);
        expect(body.Token).toBe(tbankToken(body, config.password));
        return Promise.resolve(Response.json({ ...event(status), PaymentURL: "https://securepay.tinkoff.ru/test" }));
      }
      return Promise.resolve(Response.json(event(status)));
    });
    const runtime = new BillingPayments({ prisma: db.prisma, bank, contact, grants, clock: () => now });
    const notify = (state: string, extra = {}) => { const body = event(state, extra); return { ...body, Token: tbankToken(body, config.password) }; };

    /** Расчёт, принятые согласия и команда покупки одним шагом: их порядок здесь не проверяется. */
    type Consent = "terms" | "recurring" | "personal_data";
    async function command(accepted: readonly Consent[] = ["terms"], acknowledgeExistingAccess = false) {
      const quote = value(await pricing.quote(buyer, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 }));
      const consent = await contact.acceptConsents(buyer, { operationId: randomUUID(), contextRef: quote.quoteRef,
        documents: documents.filter(document => accepted.some(kind => kind === document.kind))
          .map(document => ({ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true })) });
      if (!consent.ok) throw new Error(consent.error.code);
      return { operationId: randomUUID(), quoteRef: quote.quoteRef, contactRevision: 1,
        consentEvidenceRefs: consent.evidenceRefs, acknowledgeExistingAccess };
    }
    /** Покупка до подтверждённого банком CONFIRMED и выданных прав. */
    async function buy(accepted: readonly Consent[] = ["terms"], acknowledgeExistingAccess = false) {
      const purchase = value(await runtime.purchase(buyer, await command(accepted, acknowledgeExistingAccess)));
      expect(await runtime.notification(notify("CONFIRMED"))).toMatchObject({ ok: true });
      expect(await runtime.recover()).toMatchObject({ ok: true });
      return purchase;
    }
    return { buyer, guideId, capability, offerId, optionId, runtime, notify, command, buy,
      requests: () => requests, outcome: (state: string) => { status = state; } };
  }

  test("оплаченное руководство открывается навсегда и не заводит подписку", async () => {
    const s = await scenario();
    const purchase = await s.buy();
    const row = await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchase.purchaseRef } });
    expect(row.kind).toBe("one_time");
    expect(row.subscriptionRef).toBeNull();
    expect(row.lifecycleActive).toBe(false);
    // Оплаченного срока у разовой покупки нет, поэтому она не обещает дату окончания.
    expect(row.periodEndsAt).toBeNull();
    expect(value(await s.runtime.status(s.buyer, purchase.purchaseRef))).toMatchObject({ state: "confirmed", access: "ready", periodEndsAt: null });
    expect(await db.prisma.billingSubscription.count({ where: { accountId: s.buyer } })).toBe(0);
    const granted = await db.prisma.accessGrant.findMany({ where: { accountId: s.buyer } });
    expect(granted).toHaveLength(1);
    expect(granted[0]?.capabilities).toEqual([s.capability]);
    expect(granted[0]?.validUntil).toBeNull();
    // Банк не просят сохранять привязку: списывать по расписанию нечего.
    expect(s.requests()[0]).toMatchObject({ DATA: { OperationInitiatorType: "0" } });
    expect(s.requests()[0]).not.toHaveProperty("Recurrent");
  });

  test("право без объявленного срока остаётся бессрочным, а объявленный срок соблюдается", async () => {
    const silent = await scenario({ benefitPeriods: [] });
    await silent.buy();
    // Состав без сроков: у разовой покупки нет оплаченного периода, чтобы его унаследовать.
    expect((await db.prisma.accessGrant.findFirst({ where: { accountId: silent.buyer } }))?.validUntil).toBeNull();
    const yearly = await scenario({ term: 12 });
    await yearly.buy();
    expect((await db.prisma.accessGrant.findFirst({ where: { accountId: yearly.buyer } }))?.validUntil?.toISOString()).toBe("2031-01-31T10:00:00.000Z");
  });

  test("разовая покупка не принимает согласие на списания и требует оферту", async () => {
    const s = await scenario();
    expect(code(await s.runtime.purchase(s.buyer, await s.command(["terms", "recurring"])))).toBe("consent_required");
    expect(code(await s.runtime.purchase(s.buyer, await s.command(["personal_data"])))).toBe("consent_required");
    expect(await db.prisma.billingPurchase.count({ where: { accountId: s.buyer } })).toBe(0);
    expect(value(await s.runtime.purchase(s.buyer, await s.command(["terms"])))).toMatchObject({ state: "pending" });
  });

  test("неизвестная старая классификация не мешает купить руководство", async () => {
    const s = await scenario();
    expect(await grants.readLegacyClassification(s.buyer)).toMatchObject({ ok: true, classification: "unknown", recurringAllowed: false });
    expect(value(await s.runtime.purchase(s.buyer, await s.command()))).toMatchObject({ state: "pending" });
  });

  test("повторная покупка честно сообщает о существующем праве и не удваивает его", async () => {
    const s = await scenario();
    const first = await s.buy();
    expect(code(await s.runtime.purchase(s.buyer, await s.command()))).toBe("existing_access");
    const second = await s.buy(["terms"], true);
    expect(second.purchaseRef).not.toBe(first.purchaseRef);
    const resolved = await grants.resolveCapabilities(s.buyer);
    if (!resolved.ok) throw new Error("resolve");
    // Второе основание существует отдельно, но открытое право остаётся одним и бессрочным.
    expect(await db.prisma.accessGrant.count({ where: { accountId: s.buyer } })).toBe(2);
    expect(resolved.capabilities.filter(item => item.capability === s.capability)).toEqual([{ capability: s.capability, validUntil: null }]);
    expect(await db.prisma.billingSubscription.count({ where: { accountId: s.buyer } })).toBe(0);
  });

  test("выключенное предложение не продаёт руководство и не отзывает уже купленное", async () => {
    const s = await scenario();
    await s.buy();
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.unpublish", expectedRevision: 2, id: s.offerId }));
    // Витрина руководства его больше не видит, и новый расчёт по нему не сохраняется.
    expect(value(await pricing.offers({ mode: "one_time", capability: s.capability })).items).toEqual([]);
    expect(code(await pricing.quote(s.buyer, { operationId: randomUUID(), paymentOptionId: s.optionId, optionRevision: 1 }))).toBe("not_found");
    // Уже выданное право выключением продажи не отзывается.
    const resolved = await grants.resolveCapabilities(s.buyer);
    if (!resolved.ok) throw new Error("resolve");
    expect(resolved.capabilities).toContainEqual({ capability: s.capability, validUntil: null });
  });

  test("способ продажи сохранённого варианта не меняется задним числом", async () => {
    const s = await scenario();
    // Способ входит в принятые условия уже совершённых покупок, поэтому подписку из него не делают.
    expect(code(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", expectedRevision: 1,
      value: { id: s.optionId, offerId: s.offerId, months: 1, priceKopecks: guidePrice } }))).toBe("invalid_request");
    expect(value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", expectedRevision: 1,
      value: { id: s.optionId, offerId: s.offerId, mode: "one_time", months: 1, priceKopecks: 190_000 } }))).toMatchObject({ revision: 2 });
  });

  test("подписка не мешает купить руководство ни до, ни после неё", async () => {
    const s = await scenario();
    // Подписка того же покупателя: собственное предложение и своё место жизненного цикла.
    const subscriptionOffer = randomUUID(), subscriptionOption = randomUUID();
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save",
      value: { id: subscriptionOffer, name: "Материалы", benefits: ["materials"] } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save",
      value: { id: subscriptionOption, offerId: subscriptionOffer, months: 1, priceKopecks: 100_000 } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: subscriptionOffer }));
    await s.buy();
    expect(await db.prisma.billingSubscription.count({ where: { accountId: s.buyer } })).toBe(0);

    const classification = await grants.classifyLegacy(owner, { operationId: randomUUID(), accountId: s.buyer, expectedRevision: 0,
      classification: "confirmed_new", sourceRef: s.buyer, reason: "Synthetic new buyer", bridgeEnabled: false, tributeStopped: false });
    expect(classification.ok).toBe(true);
    const quote = value(await pricing.quote(s.buyer, { operationId: randomUUID(), paymentOptionId: subscriptionOption, optionRevision: 1 }));
    const consent = await contact.acceptConsents(s.buyer, { operationId: randomUUID(), contextRef: quote.quoteRef,
      documents: documents.filter(item => item.kind !== "personal_data")
        .map(item => ({ kind: item.kind, documentId: item.documentId, version: item.version, digest: item.digest, accepted: true })) });
    if (!consent.ok) throw new Error(consent.error.code);
    // Разовая покупка не заняла место подписки: оформить её всё ещё можно.
    expect(value(await s.runtime.purchase(s.buyer, { operationId: randomUUID(), quoteRef: quote.quoteRef, contactRevision: 1,
      consentEvidenceRefs: consent.evidenceRefs, acknowledgeExistingAccess: false }))).toMatchObject({ state: "pending" });
    expect(await s.runtime.notification(s.notify("CONFIRMED"))).toMatchObject({ ok: true });
    const subscription = await db.prisma.billingSubscription.findFirstOrThrow({ where: { accountId: s.buyer } });
    expect(subscription.state).toBe("active");

    // И обратный порядок: при действующей подписке руководство всё равно покупается отдельно.
    const another = await scenario();
    const first = value(await another.runtime.purchase(another.buyer, await another.command()));
    expect(first.state).toBe("pending");
  });

  test("витрина руководства спрашивает только своё разовое предложение", async () => {
    const s = await scenario();
    const one = value(await pricing.offers({ mode: "one_time", capability: s.capability }));
    expect(one.items.map(item => item.paymentOption.id)).toEqual([s.optionId]);
    expect(one.items[0]?.firstPriceKopecks).toBe(guidePrice);
    expect(value(await pricing.offers({ mode: "subscription" })).items.some(item => item.offer.id === s.offerId)).toBe(false);
    expect(value(await pricing.offers({ mode: "one_time", capability: `guide:${randomUUID()}` })).items).toEqual([]);
  });
});
