import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { assembleAccounts, BillingContact } from "../../src/modules/accounts/index.js";
import type { LegalDocument } from "../../src/modules/accounts/facets/billing-contact/billing-contact.contract.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants } from "../../src/modules/membership-entitlements/index.js";
import { BillingPayments, BillingPricing } from "../../src/modules/billing/index.js";
import { Tbank, tbankToken } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { syntheticTbankConfig } from "../support/bank-terminal.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
import { syntheticConsentDocument } from "./setup/consent-documents.js";

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
const guidePrice = 290_000;
/** Каталог до и после ввода новой редакции оферты разовой покупки: меняется только она. */
const previousOffer = syntheticConsentDocument("terms", { version: "purchase-v1", appliesTo: ["one_time"] });
const currentOffer = syntheticConsentDocument("terms", { version: "purchase-v3", appliesTo: ["one_time"] });
const acceptanceSchema = z.object({ evidence: z.array(z.object({ document: z.object({ version: z.string() }) })) });

/**
 * Выданный расчёт цены не несёт редакцию оферты: её несёт согласие, привязанное к расчёту. Поэтому
 * после ввода новой редакции согласие на прежнюю не открывает оплату, а покупка, уже переданная
 * в банк, подтверждается на той редакции, которую покупатель принял.
 */
describe("one-time offer edition change (real PostgreSQL and real facets; synthetic bank and email only)", () => {
  let db: TestDatabase;
  const now = new Date("2030-01-31T10:00:00Z");
  let owner: string;
  let pricing: BillingPricing;
  let grants: ReturnType<typeof assembleAccessGrants>;
  const codes = new Map<string, string>();
  const protection = billingContactProtection(Buffer.alloc(32, 42).toString("base64"));
  const contactOn = (documents: readonly LegalDocument[]) => new BillingContact({ prisma: db.prisma, protection, documents,
    now: () => now, sendCode: message => { codes.set(message.challengeRef, message.code); return Promise.resolve(); } });

  beforeAll(async () => {
    db = await createMigratedTestDatabase();
    owner = randomUUID();
    await db.prisma.account.create({ data: { id: owner, logtoIssuer: "https://identity.example.test", logtoSubject: owner } });
    await db.prisma.accountPermission.create({ data: { accountId: owner, permission: "platform:admin" } });
    const accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-billing-fingerprint-key-000000" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, clock: () => now });
    pricing = new BillingPricing({ prisma: db.prisma, accounts, clock: () => now });
  });
  afterAll(async () => db.dispose());

  /** Руководство в продаже, покупатель с подтверждённым контактом и оплата на каждом каталоге. */
  async function scenario() {
    const before = contactOn([previousOffer]);
    const after = contactOn([currentOffer]);
    const buyer = randomUUID();
    await db.prisma.account.create({ data: { id: buyer, logtoIssuer: "https://identity.example.test", logtoSubject: buyer } });
    const start = await before.start(buyer, { operationId: randomUUID(), email: `${buyer}@example.test`, expectedRevision: 0 });
    if (!start.ok) throw new Error(start.error.code);
    if (!(await before.confirm(buyer, { operationId: randomUUID(), challengeRef: start.challengeRef, code: codes.get(start.challengeRef) })).ok) throw new Error("contact");
    const capability = `guide:${randomUUID()}`;
    const offerId = randomUUID(), optionId = randomUUID();
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save", value: {
      id: offerId, name: "Руководство «Синтетика»", benefits: [capability, "support"],
      benefitPeriods: [{ capability, months: null }, { capability: "support", months: 6 }] } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", value: {
      id: optionId, offerId, mode: "one_time", months: 1, priceKopecks: guidePrice } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.publish", expectedRevision: 1, id: offerId }));

    let orderId = "";
    let paymentId = String(Math.floor(Math.random() * 1_000_000_000));
    const event = (state: string) => ({ TerminalKey: config.terminalKey, OrderId: orderId, PaymentId: paymentId,
      Amount: guidePrice, Status: state, Success: true, ErrorCode: "0" });
    const bank = new Tbank(config, (url, init) => {
      if (typeof init?.body !== "string" || typeof url !== "string") throw new Error("Unexpected bank request");
      const body = z.object({ OrderId: z.string().optional() }).loose().parse(JSON.parse(init.body));
      if (url.endsWith("/Init")) {
        orderId = z.string().parse(body.OrderId);
        paymentId = String(Number(paymentId) + 1);
        return Promise.resolve(Response.json({ ...event("NEW"), PaymentURL: "https://securepay.tinkoff.ru/test" }));
      }
      return Promise.resolve(Response.json(event("NEW")));
    });
    const paymentsOn = (contact: BillingContact) => new BillingPayments({ prisma: db.prisma, bank, contact, grants, clock: () => now });
    const confirmed = () => { const body = event("CONFIRMED"); return { ...body, Token: tbankToken(body, config.password) }; };
    const quote = async () => value(await pricing.quote(buyer, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 })).quoteRef;
    const accept = (contact: BillingContact, quoteRef: string, document: LegalDocument) => contact.acceptConsents(buyer, {
      operationId: randomUUID(), contextRef: quoteRef,
      documents: [{ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true }] });
    const command = (quoteRef: string, consentEvidenceRefs: readonly string[]) => ({ operationId: randomUUID(), quoteRef,
      contactRevision: 1, consentEvidenceRefs: [...consentEvidenceRefs], acknowledgeExistingAccess: false });
    const acceptedVersions = async (purchaseRef: string) => acceptanceSchema.parse(
      (await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchaseRef } })).acceptance,
    ).evidence.map(item => item.document.version);
    return { buyer, capability, before, after, paymentsOn, confirmed, quote, accept, command, acceptedVersions };
  }

  test("расчёт с согласием на прежнюю редакцию не оплачивается, пока покупатель не примет действующую", async () => {
    const s = await scenario();
    const quoteRef = await s.quote();
    const earlier = await s.accept(s.before, quoteRef, previousOffer);
    if (!earlier.ok) throw new Error(earlier.error.code);
    const payments = s.paymentsOn(s.after);

    // Согласие дано до ввода новой редакции: оплата его не принимает и ничего не создаёт.
    expect(code(await payments.purchase(s.buyer, s.command(quoteRef, earlier.evidenceRefs)))).toBe("consent_required");
    expect(await db.prisma.billingPurchase.count({ where: { accountId: s.buyer } })).toBe(0);
    // Устаревшая вкладка не может снова принять прежнюю редакцию.
    expect(await s.accept(s.after, quoteRef, previousOffer)).toMatchObject({ ok: false, error: { code: "document_changed" } });

    // Тот же расчёт оплачивается после согласия на действующую редакцию.
    const current = await s.accept(s.after, quoteRef, currentOffer);
    if (!current.ok) throw new Error(current.error.code);
    const purchase = value(await payments.purchase(s.buyer, s.command(quoteRef, current.evidenceRefs)));
    expect(await s.acceptedVersions(purchase.purchaseRef)).toEqual(["purchase-v3"]);
  });

  test("покупка, переданная в банк на прежней редакции, подтверждается на ней и открывает доступ", async () => {
    const s = await scenario();
    const quoteRef = await s.quote();
    const earlier = await s.accept(s.before, quoteRef, previousOffer);
    if (!earlier.ok) throw new Error(earlier.error.code);
    const purchase = value(await s.paymentsOn(s.before).purchase(s.buyer, s.command(quoteRef, earlier.evidenceRefs)));

    // Новая редакция вводится, пока банк ещё не подтвердил оплату.
    const payments = s.paymentsOn(s.after);
    expect(await payments.notification(s.confirmed())).toMatchObject({ ok: true });
    expect(await payments.recover()).toMatchObject({ ok: true });

    expect(value(await payments.status(s.buyer, purchase.purchaseRef))).toMatchObject({ state: "confirmed", access: "ready" });
    // Позднее подтверждение не переписывает принятую редакцию задним числом.
    expect(await s.acceptedVersions(purchase.purchaseRef)).toEqual(["purchase-v1"]);
    const granted = await db.prisma.accessGrant.findMany({ where: { accountId: s.buyer, capabilities: { has: s.capability } } });
    expect(granted.map(grant => grant.capabilities)).toEqual([[s.capability]]);
  });
});
