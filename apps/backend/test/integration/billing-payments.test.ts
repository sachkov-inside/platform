import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AcceptTbankNotificationController } from "../../src/modules/billing/features/accept-notification/accept-notification.controller.js";
import { ProblemDetailsFilter } from "../../src/infrastructure/http/problem-details.filter.js";
import { HttpCachePolicyInterceptor } from "../../src/infrastructure/http/http-cache-policy.js";
import { fork } from "node:child_process";
import { once } from "node:events";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { assembleAccounts, accountId, BillingContact } from "../../src/modules/accounts/index.js";
import { billingContactProtection } from "../../src/modules/accounts/infrastructure/billing-contact-protection.js";
import { assembleAccessGrants, assembleMembershipEntitlements } from "../../src/modules/membership-entitlements/index.js";
import { assembleWorkshopEntitlements } from "../../src/modules/workshop/index.js";
import { BillingPayments, BillingPricing } from "../../src/modules/billing/index.js";
import { Tbank, tbankToken } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { tbankConfigSchema } from "../../src/config/tbank-config.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code); return result.value;
}
const config = tbankConfigSchema.parse({ environment: "demo", terminalKey: "SYNTHETICDEMO", password: "synthetic-test-password",
  bindingEncryptionKey: Buffer.alloc(32, 43).toString("base64"), recurringCardConfirmed: true, cardOnlyHostedConfirmed: true,
  minimumKopecks: 100, maximumKopecks: 1_000_000, returnUrl: "https://inside.example.test/account", notificationUrl: "https://inside.example.test/billing/tbank/notification",
  receipt: { taxation: "usn_income", tax: "none" } });
const documents = (["terms", "recurring"] as const).map(kind => { const text = `Synthetic ${kind}, not legal terms`;
  return { kind, documentId: kind, version: "test-v1", text, digest: createHash("sha256").update(text).digest("hex"), url: `https://example.test/${kind}` }; });

describe("subscription payment recovery (real PostgreSQL and real facets; synthetic bank and email only)", () => {
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
    accounts = assembleAccounts({ prisma: db.prisma, emailFingerprintKey: "synthetic-billing-fingerprint-key-000000" });
    grants = assembleAccessGrants({ prisma: db.prisma, accounts, clock: () => now });
    pricing = new BillingPricing({ prisma: db.prisma, accounts, clock: () => now });
    contact = new BillingContact({ prisma: db.prisma, protection: billingContactProtection(Buffer.alloc(32, 42).toString("base64")),
      documents, now: () => now, sendCode: message => { codes.set(message.challengeRef, message.code); return Promise.resolve(); } });
  });
  afterAll(async () => db.dispose());
  async function scenario(benefits = ["materials"], benefitPeriods?: { capability: string; months: number | null }[]) {
    now = new Date("2030-01-31T10:00:00Z");
    const buyer = randomUUID();
    await db.prisma.account.create({ data: { id: buyer, logtoIssuer: "https://identity.example.test", logtoSubject: buyer } });
    const classification = await grants.classifyLegacy(owner, { operationId: randomUUID(), accountId: buyer, expectedRevision: 0,
      classification: "confirmed_new", sourceRef: buyer, reason: "Synthetic new buyer", bridgeEnabled: false, tributeStopped: false });
    expect(classification.ok).toBe(true);
    const start = await contact.start(buyer, { operationId: randomUUID(), email: `${buyer}@example.test`, expectedRevision: 0 });
    if (!start.ok) throw new Error(start.error.code);
    expect(await contact.confirm(buyer, { operationId: randomUUID(), challengeRef: start.challengeRef, code: codes.get(start.challengeRef) })).toMatchObject({ ok: true });
    const offerId = randomUUID(), optionId = randomUUID();
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.save", value: { id: offerId, name: "Synthetic subscription", benefits, ...(benefitPeriods ? { benefitPeriods } : {}) } }));
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "paymentOptions.save", value: { id: optionId, offerId, months: 1, priceKopecks: 200_000 } }));
    const quote = value(await pricing.quote(buyer, { operationId: randomUUID(), paymentOptionId: optionId, optionRevision: 1 }));
    const consent = await contact.acceptConsents(buyer, { operationId: randomUUID(), contextRef: quote.quoteRef, documents: documents.map(document => ({ kind: document.kind, documentId: document.documentId, version: document.version, digest: document.digest, accepted: true })) });
    if (!consent.ok) throw new Error(consent.error.code);
    const command = { operationId: randomUUID(), quoteRef: quote.quoteRef, contactRevision: 1, consentEvidenceRefs: consent.evidenceRefs, acknowledgeExistingAccess: false };
    let requests = 0, initOutcome = "NEW", failInit = false;
    let orderId = "";
    const paymentId = String(Math.floor(Math.random() * 1_000_000_000));
    const event = (status: string, extra = {}) => ({ TerminalKey: config.terminalKey, OrderId: orderId, PaymentId: paymentId, Amount: 200_000, Status: status, Success: true, ErrorCode: "0", ...extra });
    const bank = new Tbank(config, async (url, init) => {
      if (typeof init?.body !== "string" || typeof url !== "string") throw new Error("Unexpected bank request");
      const body = z.object({ OrderId: z.string().optional(), Token: z.string(), Receipt: z.object({ Email: z.string() }).optional() }).loose().parse(JSON.parse(init.body));
      if (url.endsWith("/Init")) {
        requests += 1; orderId = z.string().parse(body.OrderId);
        const row = await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: orderId } });
        expect(row.state).toBe("sent");
        expect(await db.prisma.billingPromoReservation.findUnique({ where: { purchaseRef: orderId } })).toMatchObject({ state: "sent" });
        expect(body.Receipt?.Email).toBe(`${buyer}@example.test`);
        expect(body.Token).toBe(tbankToken(body, config.password));
        if (failInit) throw new Error("Synthetic timeout after bank acceptance");
        return Response.json({ ...event(initOutcome), PaymentURL: "https://securepay.tinkoff.ru/test" });
      }
      if (url.endsWith("/CheckOrder")) return Response.json({ Success: true, ErrorCode: "0", TerminalKey: config.terminalKey, OrderId: body.OrderId, Payments: [{ PaymentId: paymentId, Status: initOutcome, Success: true, ErrorCode: 0 }] });
      return Response.json(event(initOutcome));
    });
    const runtime = (projector = grants) => new BillingPayments({ prisma: db.prisma, bank, contact, grants: projector, clock: () => now });
    const notify = (status: string, extra = {}) => { const body = event(status, extra); return { ...body, Token: tbankToken(body, config.password) }; };
    return { buyer, command, offerId, quote, runtime, notify, requests: () => requests, timeout: () => { failInit = true; }, outcome: (value: string) => { initOutcome = value; } };
  }

  test("two tabs and concurrent CONFIRMED create one payment and one set of grants; return status is not payment evidence", async () => {
    const s = await scenario(["materials", "support", "community"], [{ capability: "support", months: 2 }]);
    const runtime = s.runtime();
    const [first, second] = await Promise.all([runtime.purchase(s.buyer, s.command), runtime.purchase(s.buyer, { ...s.command, operationId: randomUUID() })]);
    const purchase = value(first);
    expect(value(second).purchaseRef).toBe(purchase.purchaseRef);
    expect(s.requests()).toBe(1);
    expect(purchase.state).toBe("pending");
    expect(purchase.access).toBe("awaiting_payment");
    expect(await runtime.notification(s.notify("AUTHORIZED", { RebillId: "synthetic-saved-method" }))).toMatchObject({ ok: true });
    expect(await db.prisma.accessGrant.count({ where: { accountId: s.buyer } })).toBe(0);
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef)).state).toBe("authorized");
    expect((await Promise.all(Array.from({ length: 6 }, () => runtime.notification(s.notify("CONFIRMED"))))).every(result => result.ok)).toBe(true);
    expect(await db.prisma.billingPaymentEvent.count({ where: { purchaseRef: purchase.purchaseRef } })).toBe(1);
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef))).toMatchObject({ state: "confirmed", access: "preparing", periodEndsAt: "2030-02-28T10:00:00.000Z", fiscalization: "pending" });
    expect(await runtime.recover()).toMatchObject({ ok: true });
    const saved = await db.prisma.accessGrant.findMany({ where: { accountId: s.buyer } });
    expect(saved).toHaveLength(3);
    expect(saved.find(grant => grant.capabilities.includes("support"))?.validUntil?.toISOString()).toBe("2030-03-31T10:00:00.000Z");
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef)).access).toBe("ready");
    await runtime.notification(s.notify("AUTHORIZED"));
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef)).state).toBe("confirmed");
    expect((await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchase.purchaseRef } })).bindingCiphertext).not.toContain("synthetic-saved-method");
    expect(await runtime.status(owner, purchase.purchaseRef)).toMatchObject({ error: { code: "not_found" } });
  });

  test("unknown Init survives restart and cannot be retried; CheckOrder confirms once", async () => {
    const s = await scenario(); s.timeout();
    const runtime = s.runtime();
    const purchase = value(await runtime.purchase(s.buyer, s.command));
    expect(purchase.state).toBe("unknown");
    expect(value(await s.runtime().purchase(s.buyer, s.command)).purchaseRef).toBe(purchase.purchaseRef);
    expect(s.requests()).toBe(1);
    s.outcome("CONFIRMED");
    expect(await s.runtime().reconcile(purchase.purchaseRef)).toMatchObject({ ok: true });
    expect(await s.runtime().recover()).toMatchObject({ ok: true });
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef)).access).toBe("ready");
    expect(s.requests()).toBe(1);
    expect(await db.prisma.accessGrant.count({ where: { accountId: s.buyer } })).toBe(1);
  });

  test.each(["notification", "reconciliation"] as const)("first verified %s starts a full period and late replays keep its original bounds", async source => {
    const s = await scenario();
    const runtime = s.runtime();
    const purchase = value(await runtime.purchase(s.buyer, s.command));
    await runtime.notification(s.notify("AUTHORIZED"));
    now = new Date("2030-02-02T14:15:00Z");
    if (source === "notification") await runtime.notification(s.notify("CONFIRMED"));
    else { s.outcome("CONFIRMED"); expect(await runtime.reconcile(purchase.purchaseRef)).toMatchObject({ ok: true }); }
    const bounds = { confirmedAt: "2030-02-02T14:15:00.000Z", periodEndsAt: "2030-03-02T14:15:00.000Z" };
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef))).toMatchObject(bounds);
    now = new Date("2030-02-10T00:00:00Z");
    await Promise.all([runtime.notification(s.notify("CONFIRMED")), runtime.reconcile(purchase.purchaseRef), runtime.recover()]);
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef))).toMatchObject({ ...bounds, access: "ready" });
    const granted = await db.prisma.accessGrant.findMany({ where: { accountId: s.buyer } });
    expect(granted).toHaveLength(1);
    expect(granted[0]?.startsAt.toISOString()).toBe(bounds.confirmedAt);
    expect(granted[0]?.validUntil?.toISOString()).toBe(bounds.periodEndsAt);
  });

  test("signature and terminal/order/payment/amount matching precede dedupe", async () => {
    const s = await scenario(); const runtime = s.runtime();
    const purchase = value(await runtime.purchase(s.buyer, s.command));
    for (const extra of [{ Amount: 1 }, { TerminalKey: "OTHER" }, { PaymentId: "OTHER" }, { OrderId: randomUUID() }, { Success: false }])
      expect(await runtime.notification(s.notify("CONFIRMED", extra))).toMatchObject({ ok: false });
    expect(await runtime.notification({ ...s.notify("CONFIRMED"), Token: "0".repeat(64) })).toMatchObject({ ok: false });
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef)).access).toBe("awaiting_payment");
    expect(await runtime.notification(s.notify("CONFIRMED"))).toMatchObject({ ok: true });
    expect(await runtime.notification(s.notify("CONFIRMED", { Amount: 1 }))).toMatchObject({ ok: false });
  });

  test("fulfillment failure replays without bank I/O; saved conditions survive offer archive and PostgreSQL rejects mutation", async () => {
    const s = await scenario(); const runtime = s.runtime();
    const purchase = value(await runtime.purchase(s.buyer, s.command));
    await runtime.notification(s.notify("CONFIRMED"));
    const failing = s.runtime({ ...grants, applyPaidPeriod: () => Promise.resolve({ ok: false, error: { code: "unavailable" } }) });
    await failing.recover();
    expect(value(await failing.status(s.buyer, purchase.purchaseRef)).access).toBe("preparing");
    value(await pricing.manage(owner, { operationId: randomUUID(), operation: "offers.archive", id: s.offerId, expectedRevision: 1 }));
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef)).snapshot).toEqual(s.quote.snapshot);
    await expect(db.prisma.billingPurchase.update({ where: { id: purchase.purchaseRef }, data: { snapshot: {} } })).rejects.toThrow();
    await expect(db.prisma.billingPaymentEvent.deleteMany({ where: { purchaseRef: purchase.purchaseRef } })).rejects.toThrow();
    now = new Date(now.getTime() + 60_000);
    await s.runtime().recover(); await s.runtime().recover();
    expect(await db.prisma.accessGrant.count({ where: { accountId: s.buyer } })).toBe(1);
    expect(s.requests()).toBe(1);
    const membership = assembleMembershipEntitlements({ prisma: db.prisma, clock: () => now,
      workshopEntitlements: assembleWorkshopEntitlements({ prisma: db.prisma, clock: () => now }) });
    expect(await membership.resolveForAccess(accountId(s.buyer))).toMatchObject({ kind: "active" });
  });
  test("SIGKILL after durable Init admission and after confirmation recovers without another charge", async () => {
    const s = await scenario();
    const child = fork(new URL("./fixtures/billing-payment-crash.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: { ...process.env, BILLING_CRASH_FIXTURE: JSON.stringify({ databaseUrl: db.url, config, documents, buyer: s.buyer, command: s.command, now: now.toISOString() }) },
    });
    let purchaseRef: string;
    try {
      const messages: unknown = await once(child, "message");
      purchaseRef = z.tuple([z.object({ purchaseRef: z.uuid() })]).rest(z.unknown()).parse(messages)[0].purchaseRef;
      child.kill("SIGKILL"); await once(child, "exit");
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    const row = await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchaseRef } });
    expect(row.state).toBe("sent");
    expect(value(await s.runtime().purchase(s.buyer, s.command)).purchaseRef).toBe(purchaseRef);
    expect(s.requests()).toBe(0);
    const payment = { TerminalKey: config.terminalKey, OrderId: purchaseRef, PaymentId: "crash-bank-payment", Amount: 200_000, Status: "CONFIRMED", Success: true, ErrorCode: "0" };
    const confirming = fork(new URL("./fixtures/billing-payment-crash.ts", import.meta.url), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"],
      env: { ...process.env, BILLING_CRASH_FIXTURE: JSON.stringify({ databaseUrl: db.url, config, documents, buyer: s.buyer, command: s.command, now: now.toISOString(), notification: { ...payment, Token: tbankToken(payment, config.password) } }) },
    });
    try {
      const messages: unknown = await once(confirming, "message");
      expect(messages).toEqual(expect.arrayContaining(["confirmed"]));
      confirming.kill("SIGKILL"); await once(confirming, "exit");
    } finally { if (confirming.exitCode === null && confirming.signalCode === null) confirming.kill("SIGKILL"); }
    expect(value(await s.runtime().status(s.buyer, purchaseRef)).access).toBe("preparing");
    await s.runtime().recover(); await s.runtime().recover();
    expect(value(await s.runtime().status(s.buyer, purchaseRef)).access).toBe("ready");
    expect(await db.prisma.accessGrant.count({ where: { accountId: s.buyer } })).toBe(1);
    expect(s.requests()).toBe(0);
  }, 15_000);

  test("HTTP callback acknowledges only durable valid notifications as plain text", async () => {
    const s = await scenario(); const payments = s.runtime();
    await payments.purchase(s.buyer, s.command);
    @Module({ controllers: [AcceptTbankNotificationController], providers: [{ provide: BillingPayments, useValue: payments }] })
    // oxlint-disable-next-line typescript/no-extraneous-class -- Nest requires a concrete module class for the HTTP fixture.
    class CallbackFixtureModule {}
    const http = await NestFactory.create<NestFastifyApplication>(CallbackFixtureModule, new FastifyAdapter(), { logger: false });
    http.useGlobalFilters(new ProblemDetailsFilter());
    http.useGlobalInterceptors(new HttpCachePolicyInterceptor(new Reflector()));
    await http.init(); await http.getHttpAdapter().getInstance().ready();
    try {
      const success = await http.inject({ method: "POST", url: "/billing/tbank/notification", payload: s.notify("CONFIRMED") });
      expect(success.statusCode).toBe(200); expect(success.body).toBe("OK");
      expect(success.headers["content-type"]).toContain("text/plain");
      expect(success.headers["cache-control"]).toBe("private, no-store");
      const invalid = await http.inject({ method: "POST", url: "/billing/tbank/notification", payload: { ...s.notify("CONFIRMED"), Token: "bad" } });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.headers["content-type"]).toContain("application/problem+json");
      expect(invalid.json<unknown>()).toMatchObject({ code: "invalid_notification" });
    } finally { await http.close(); }
  });

  test("a permanently rejected fulfillment does not starve later purchases", async () => {
    const first = await scenario(); const second = await scenario();
    const firstPurchase = value(await first.runtime().purchase(first.buyer, first.command));
    const secondPurchase = value(await second.runtime().purchase(second.buyer, second.command));
    await first.runtime().notification(first.notify("CONFIRMED"));
    await second.runtime().notification(second.notify("CONFIRMED"));
    await db.prisma.billingFulfillment.updateMany({ where: { purchaseRef: firstPurchase.purchaseRef }, data: { nextAttemptAt: new Date("2029-01-01T00:00:00Z") } });
    const rejecting = first.runtime({ ...grants, applyPaidPeriod: input => input.accountId === first.buyer
      ? Promise.resolve({ ok: false, error: { code: "not_found" } }) : grants.applyPaidPeriod(input) });
    await rejecting.recover(1);
    expect(value(await first.runtime().status(first.buyer, firstPurchase.purchaseRef)).access).toBe("preparing");
    // Other tests may have left valid pending outbox rows: bounded passes must still reach this buyer.
    for (let i = 0; i < 20; i += 1) await rejecting.recover(1);
    expect(value(await second.runtime().status(second.buyer, secondPurchase.purchaseRef)).access).toBe("ready");
  });

  test("receipt result is separate from confirmation and cannot create access", async () => {
    const s = await scenario(); const runtime = s.runtime();
    const purchase = value(await runtime.purchase(s.buyer, s.command));
    expect(await runtime.notification(s.notify("RECEIPT", { Success: false, ErrorCode: "receipt-error" }))).toMatchObject({ ok: true });
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef))).toMatchObject({ fiscalization: "failed", access: "awaiting_payment" });
    await runtime.notification(s.notify("RECEIPT"));
    expect(value(await runtime.status(s.buyer, purchase.purchaseRef))).toMatchObject({ fiscalization: "confirmed", access: "awaiting_payment" });
    await runtime.notification(s.notify("CONFIRMED"));
    await runtime.notification(s.notify("AUTHORIZED", { RebillId: "late-saved-method" }));
    expect((await db.prisma.billingPurchase.findUniqueOrThrow({ where: { id: purchase.purchaseRef } })).bindingCiphertext).toBeTruthy();
  });

});
