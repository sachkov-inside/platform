import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { BillingContact } from "../../../accounts/index.js";
import type { AccessGrants } from "../../../membership-entitlements/index.js";
import { priceSnapshotSchema } from "../../domain/pricing.js";
import { subscriptionPeriodEnd } from "../../domain/subscription-period.js";
import { lockPricing } from "../../infrastructure/postgres/catalog-lock.js";
import { bankTimeoutMs, type Tbank, validatedPaymentUrl, type BankPayment } from "../../infrastructure/tbank/tbank.js";
import { reservePurchaseInTransaction } from "../../features/reserve-purchase/reserve-purchase.js";
import { paymentFailure, purchaseSubscriptionSchema, purchaseStatusSchema, type PaymentResult, type PurchaseStatus } from "../../features/purchase-subscription/purchase-subscription.contract.js";
import { paidPeriodCommandSchema } from "../../../membership-entitlements/index.js";

const fulfillmentRetryDelayMilliseconds = 60_000;
// Derived from the bank's own timeout so a joining caller outlives exactly one honest round-trip.
const inFlightAnswerBudgetMilliseconds = bankTimeoutMs + 2_000;
const inFlightAnswerPollMilliseconds = 50;

// Why this caller did not perform the bank round-trip. Only an in-flight send is worth waiting for.
type SendOutcome = "sent" | "in_flight" | "not_sendable";

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly contact: Pick<BillingContact, "read" | "readConsent">;
  readonly grants: Pick<AccessGrants, "readLegacyClassification" | "resolveCapabilities" | "applyPaidPeriod">;
  readonly bank: Tbank | undefined;
  readonly clock?: () => Date;
}

/** Purchase, authoritative confirmation and recoverable fulfillment. Never repeats Init. */
export class BillingPayments {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: Dependencies) { this.clock = dependencies.clock ?? (() => new Date()); }

  async purchase(accountId: string, input: unknown): Promise<PaymentResult<PurchaseStatus>> {
    const parsed = purchaseSubscriptionSchema.safeParse(input);
    if (!z.uuid().safeParse(accountId).success || !parsed.success) return paymentFailure("invalid_request");
    const bank = this.dependencies.bank;
    if (!bank) return paymentFailure("method_unavailable");
    const command = parsed.data;
    const fingerprint = JSON.stringify(command);
    try {
      const replay = await this.dependencies.prisma.billingPurchaseCommand.findUnique({ where: { accountId_operationId: { accountId, operationId: command.operationId } } });
      if (replay) return replay.fingerprint === fingerprint ? await this.status(accountId, replay.purchaseRef) : paymentFailure("operation_conflict");
      const [contact, legacy, capabilities] = await Promise.all([
        this.dependencies.contact.read(accountId), this.dependencies.grants.readLegacyClassification(accountId), this.dependencies.grants.resolveCapabilities(accountId),
      ]);
      if (!contact.ok || !legacy.ok || !capabilities.ok) return paymentFailure("dependency_unavailable");
      if (!contact.contact || contact.contact.revision !== command.contactRevision) return paymentFailure("contact_required");
      if (!legacy.recurringAllowed) return paymentFailure("legacy_review_required");
      const verifiedContact = contact.contact;
      const consents = await Promise.all(command.consentEvidenceRefs.map(ref => this.dependencies.contact.readConsent(accountId, ref)));
      if (consents.some(result => !result.ok)) return paymentFailure("consent_required");
      const evidence = consents.flatMap(result => result.ok ? [result.evidence] : []);
      if (new Set(evidence.map(value => value.document.kind)).size !== evidence.length ||
        evidence.some(value => value.contextRef !== command.quoteRef || !contact.documents.some(document =>
          document.kind === value.document.kind && document.documentId === value.document.documentId && document.version === value.document.version && document.digest === value.document.digest)) ||
        !["terms", "recurring"].every(kind => evidence.some(value => value.document.kind === kind))) return paymentFailure("consent_required");
      const prepared = await this.dependencies.prisma.$transaction(async (tx): Promise<PaymentResult<string>> => {
        await lockPricing(tx);
        const key = { accountId, operationId: command.operationId };
        const existingCommand = await tx.billingPurchaseCommand.findUnique({ where: { accountId_operationId: key } });
        if (existingCommand) return existingCommand.fingerprint === fingerprint ? { ok: true, value: existingCommand.purchaseRef } : paymentFailure("operation_conflict");
        const now = this.clock();
        // A completed lifecycle remains in history; only a later new purchase can reserve another slot.
        await tx.billingPurchase.updateMany({ where: { accountId, state: "confirmed", lifecycleActive: true, periodEndsAt: { lte: now } }, data: { lifecycleActive: false } });
        const current = await tx.billingPurchase.findFirst({ where: { accountId, lifecycleActive: true, state: { not: "failed" } } });
        if (current) {
          if (current.state === "confirmed") return paymentFailure("payment_in_progress");
          await tx.billingPurchaseCommand.create({ data: { ...key, fingerprint, purchaseRef: current.id } });
          return { ok: true, value: current.id };
        }
        const purchaseRef = randomUUID();
        const reservation = await reservePurchaseInTransaction(tx, { accountId, purchaseRef, quoteRef: command.quoteRef,
          amountLimits: { minimumKopecks: bank.config.minimumKopecks, maximumKopecks: bank.config.maximumKopecks } }, now);
        if (!reservation.ok) return paymentFailure(reservation.error.code === "reservation_conflict" ? "payment_in_progress" : reservation.error.code);
        if (!command.acknowledgeExistingAccess && capabilities.capabilities.some(value => reservation.value.offer.benefits.includes(value.capability))) {
          // No external effect exists; release the pricing capacity in this transaction.
          await tx.billingPromoReservation.delete({ where: { purchaseRef } });
          return paymentFailure("existing_access");
        }
        await tx.billingPurchase.create({ data: {
          id: purchaseRef, accountId, quoteRef: command.quoteRef, state: "prepared", environment: bank.config.environment,
          terminalRef: bank.config.terminalKey, amountKopecks: reservation.value.firstPriceKopecks,
          snapshot: reservation.value, acceptance: { command, evidence }, contact: { revision: verifiedContact.revision, verifiedAt: verifiedContact.verifiedAt, emailCiphertext: bank.sealBinding(`${purchaseRef}:contact`, verifiedContact.email) },
          fiscalization: "pending", createdAt: now, updatedAt: now,
        } });
        await tx.billingPurchaseCommand.create({ data: { ...key, fingerprint, purchaseRef } });
        return { ok: true, value: purchaseRef };
      });
      if (!prepared.ok) return prepared;
      // A concurrent tab joins an existing purchase and sends nothing. Its answer must be the
      // settled result of the caller that did send, never the interim row that carries no payment URL.
      if (await this.sendPrepared(prepared.value) === "in_flight") await this.awaitBankAnswer(prepared.value);
      return await this.status(accountId, prepared.value);
    } catch { return paymentFailure("dependency_unavailable"); }
  }

  async status(accountId: string, purchaseRef: string): Promise<PaymentResult<PurchaseStatus>> {
    if (!z.uuid().safeParse(accountId).success || !z.uuid().safeParse(purchaseRef).success) return paymentFailure("not_found");
    try {
      const row = await this.dependencies.prisma.billingPurchase.findFirst({ where: { id: purchaseRef, accountId } });
      if (!row) return paymentFailure("not_found");
      const waiting = await this.dependencies.prisma.billingFulfillment.count({ where: { purchaseRef, appliedAt: null } });
      return { ok: true, value: purchaseStatusSchema.parse({
        purchaseRef, state: row.state, paymentUrl: row.state === "pending" ? row.paymentUrl : null,
        snapshot: row.snapshot, access: row.state !== "confirmed" ? "awaiting_payment" : waiting ? "preparing" : "ready",
        fiscalization: row.fiscalization, confirmedAt: row.confirmedAt?.toISOString() ?? null, periodEndsAt: row.periodEndsAt?.toISOString() ?? null,
      }) };
    } catch { return paymentFailure("dependency_unavailable"); }
  }

  async notification(input: unknown): Promise<PaymentResult<true>> {
    const payment = this.dependencies.bank?.notification(input);
    if (!payment) return paymentFailure("invalid_notification");
    return this.accept(payment);
  }

  async reconcile(purchaseRef: string): Promise<PaymentResult<true>> {
    const { prisma, bank } = this.dependencies;
    if (!bank) return paymentFailure("method_unavailable");
    try {
      const row = await prisma.billingPurchase.findUnique({ where: { id: purchaseRef } });
      if (!row) return paymentFailure("not_found");
      if (row.environment !== bank.config.environment || row.terminalRef !== bank.config.terminalKey) return paymentFailure("method_unavailable");
      if (row.state === "prepared") { await this.sendPrepared(row.id); return { ok: true, value: true }; }
      if (row.state === "confirmed" || row.state === "failed") return { ok: true, value: true };
      let paymentId = row.paymentId;
      if (!paymentId) {
        const candidates = await bank.order(row.id);
        // Empty/multiple results are uncertainty, not permission to send another Init.
        if (candidates.length !== 1 || !candidates[0]) return paymentFailure("provider_unavailable");
        paymentId = candidates[0];
      }
      const payment = await bank.state(paymentId);
      if (payment.OrderId !== row.id || payment.PaymentId !== paymentId) return paymentFailure("invalid_notification");
      return await this.accept(payment);
    } catch { return paymentFailure("provider_unavailable"); }
  }

  async recover(limit = 50): Promise<PaymentResult<{ inspected: number; applied: number }>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return paymentFailure("invalid_request");
    try {
      const rows = await this.dependencies.prisma.billingPurchase.findMany({ where: { state: { in: ["prepared", "sent", "unknown", "pending", "authorized"] } }, orderBy: { updatedAt: "asc" }, take: limit });
      for (const row of rows) {
        await this.reconcile(row.id);
        await this.dependencies.prisma.billingPurchase.update({ where: { id: row.id }, data: { updatedAt: this.clock() } });
      }
      const pending = await this.dependencies.prisma.billingFulfillment.findMany({ where: { appliedAt: null, nextAttemptAt: { lte: this.clock() } }, orderBy: [{ nextAttemptAt: "asc" }, { eventRef: "asc" }], take: limit });
      let applied = 0;
      for (const row of pending) {
        // A failed item moves behind other work; a process crash leaves it recoverable after a minute.
        await this.dependencies.prisma.billingFulfillment.update({ where: { eventRef: row.eventRef }, data: { nextAttemptAt: new Date(this.clock().getTime() + fulfillmentRetryDelayMilliseconds) } });
        const parsed = paidPeriodCommandSchema.safeParse(row.payload);
        if (!parsed.success) continue;
        const command = parsed.data;
        const result = await this.dependencies.grants.applyPaidPeriod(command);
        if (result.ok) {
          await this.dependencies.prisma.billingFulfillment.update({ where: { eventRef: row.eventRef }, data: { appliedAt: this.clock() } });
          applied += 1;
        }
      }
      return { ok: true, value: { inspected: rows.length, applied } };
    } catch { return paymentFailure("dependency_unavailable"); }
  }

  // Waits out another caller's bank round-trip. The budget exceeds the bank timeout, so an
  // abandoned attempt still returns the current row instead of hanging; recovery owns that row.
  private async awaitBankAnswer(purchaseRef: string): Promise<void> {
    const deadline = Date.now() + inFlightAnswerBudgetMilliseconds;
    for (;;) {
      const row = await this.dependencies.prisma.billingPurchase.findUnique({ where: { id: purchaseRef }, select: { state: true } });
      if (row?.state !== "sent" || Date.now() >= deadline) return;
      await delay(inFlightAnswerPollMilliseconds);
    }
  }

  private async sendPrepared(purchaseRef: string): Promise<SendOutcome> {
    const { prisma, bank } = this.dependencies;
    if (!bank) return "not_sendable";
    const outcome = await prisma.$transaction(async tx => {
      await lockPricing(tx);
      const row = await tx.billingPurchase.findUnique({ where: { id: purchaseRef } });
      // A row past `prepared` belongs to another caller; a foreign terminal is nobody's to send.
      if (!row || row.terminalRef !== bank.config.terminalKey || row.environment !== bank.config.environment) return "not_sendable" as const;
      if (row.state !== "prepared") return "in_flight" as const;
      await tx.billingPurchase.update({ where: { id: purchaseRef }, data: { state: "sent", updatedAt: this.clock() } });
      await tx.billingPromoReservation.update({ where: { purchaseRef }, data: { state: "sent" } });
      return row;
    });
    if (typeof outcome === "string") return outcome;
    const row = outcome;
    try {
      const snapshot = priceSnapshotSchema.parse(row.snapshot);
      const contact = z.object({ emailCiphertext: z.string() }).parse(row.contact);
      const email = z.email().parse(bank.openBinding(`${row.id}:contact`, contact.emailCiphertext));
      const payment = await bank.init({ orderId: row.id, accountId: row.accountId, amount: Number(row.amountKopecks), name: snapshot.offer.name, email });
      const accepted = await this.accept(payment, payment.PaymentURL);
      if (!accepted.ok) throw new Error("Bank initialization fact rejected");
    } catch {
      await prisma.$transaction(async tx => {
        await lockPricing(tx);
        const changed = await tx.billingPurchase.updateMany({ where: { id: row.id, state: "sent" }, data: { state: "unknown", updatedAt: this.clock() } });
        if (changed.count) await tx.billingPromoReservation.update({ where: { purchaseRef }, data: { state: "unknown" } });
      });
    }
    return "sent";
  }

  private async accept(payment: BankPayment, paymentUrl?: string): Promise<PaymentResult<true>> {
    const { prisma, bank } = this.dependencies;
    if (!bank) return paymentFailure("method_unavailable");
    try {
      return await prisma.$transaction(async tx => {
        await lockPricing(tx);
        const row = await tx.billingPurchase.findUnique({ where: { id: payment.OrderId } });
        if (!row || row.environment !== bank.config.environment || row.terminalRef !== payment.TerminalKey || row.terminalRef !== bank.config.terminalKey ||
          Number(row.amountKopecks) !== payment.Amount || (row.paymentId !== null && row.paymentId !== payment.PaymentId) || row.state === "prepared") return paymentFailure("invalid_notification");
        if (payment.Status === "RECEIPT") {
          const fiscalization = payment.Success && payment.ErrorCode === "0" ? "confirmed" : "failed";
          // A receipt is never a payment proof. A late failure cannot overwrite confirmed fiscalization.
          if (row.fiscalization !== "confirmed") await tx.billingPurchase.update({ where: { id: row.id }, data: { fiscalization } });
          const kind = `fiscalization_${fiscalization}`;
          if (!await tx.billingPaymentEvent.findUnique({ where: { purchaseRef_kind: { purchaseRef: row.id, kind } } })) {
            const observedAt = this.clock();
            await tx.billingPaymentEvent.create({ data: { id: randomUUID(), purchaseRef: row.id, kind,
              payload: { paymentId: payment.PaymentId, amountKopecks: payment.Amount, errorCode: payment.ErrorCode },
              occurredAt: observedAt, recordedAt: observedAt } });
          }
          return { ok: true, value: true };
        }
        if (row.state === "confirmed") {
          if (payment.RebillId && !row.bindingCiphertext && payment.Success && payment.ErrorCode === "0")
            await tx.billingPurchase.update({ where: { id: row.id }, data: { bindingCiphertext: bank.sealBinding(row.id, payment.RebillId) } });
          return { ok: true, value: true };
        }
        if (row.state === "failed") return payment.Status === "CONFIRMED" ? paymentFailure("invalid_notification") : { ok: true, value: true };
        const now = this.clock();
        const common = { paymentId: payment.PaymentId, updatedAt: now,
          ...(payment.RebillId ? { bindingCiphertext: bank.sealBinding(row.id, payment.RebillId) } : {}),
        };
        if (payment.Status === "CONFIRMED") {
          if (!payment.Success || payment.ErrorCode !== "0") return paymentFailure("invalid_notification");
          // The first durably verified CONFIRMED starts the full period; replays returned above.
          const paidAt = now;
          const snapshot = priceSnapshotSchema.parse(row.snapshot);
          const endsAt = subscriptionPeriodEnd(paidAt, snapshot.paymentOption.months);
          const eventRef = randomUUID();
          await tx.billingPurchase.update({ where: { id: row.id }, data: { ...common, state: "confirmed", confirmedAt: paidAt, periodEndsAt: endsAt, paymentUrl: null } });
          await tx.billingPromoReservation.update({ where: { purchaseRef: row.id }, data: { state: "confirmed" } });
          await tx.billingPaymentEvent.create({ data: { id: eventRef, purchaseRef: row.id, kind: "payment_confirmed", payload: { accountId: row.accountId, amountKopecks: payment.Amount, periodRef: row.id, startsAt: paidAt.toISOString(), endsAt: endsAt.toISOString(), snapshot }, occurredAt: paidAt, recordedAt: now } });
          for (const capability of snapshot.offer.benefits) {
            const term = snapshot.offer.benefitPeriods?.find(value => value.capability === capability);
            const validUntil = term?.months === null ? null : subscriptionPeriodEnd(paidAt, term?.months ?? snapshot.paymentOption.months).toISOString();
            const grantEventRef = randomUUID();
            const command = { eventRef: grantEventRef, periodRef: `${row.id}:${capability}`, accountId: row.accountId, revision: 1, revoked: false,
              terms: { capabilities: [capability], startsAt: paidAt.toISOString(), validUntil, reason: `Confirmed payment ${row.id}` } };
            await tx.billingFulfillment.create({ data: { eventRef: grantEventRef, purchaseRef: row.id, payload: command } });
          }
        } else if (["REJECTED", "AUTH_FAIL", "CANCELED", "DEADLINE_EXPIRED", "REVERSED"].includes(payment.Status)) {
          await tx.billingPurchase.update({ where: { id: row.id }, data: { ...common, state: "failed", lifecycleActive: false, paymentUrl: null } });
          await tx.billingPromoReservation.update({ where: { purchaseRef: row.id }, data: { state: "failed" } });
        } else if (["REVERSING", "REFUNDING", "PARTIAL_REFUNDED", "REFUNDED"].includes(payment.Status) || !payment.Success || payment.ErrorCode !== "0") {
          // An unsupported or contradictory bank state requires reconciliation, never a new charge.
          await tx.billingPurchase.update({ where: { id: row.id }, data: { ...common, state: "unknown", paymentUrl: null } });
        } else {
          const authorized = row.state === "authorized" || payment.Status === "AUTHORIZED";
          await tx.billingPurchase.update({ where: { id: row.id }, data: { ...common, state: authorized ? "authorized" : "pending",
            ...(paymentUrl && !authorized ? { paymentUrl: validatedPaymentUrl(paymentUrl) } : {}) } });
        }
        return { ok: true, value: true };
      });
    } catch { return paymentFailure("dependency_unavailable"); }
  }
}
