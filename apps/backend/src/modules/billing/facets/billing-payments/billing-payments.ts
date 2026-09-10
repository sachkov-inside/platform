import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { BillingContact } from "../../../accounts/index.js";
import type { AccessGrants } from "../../../membership-entitlements/index.js";
import { priceSnapshotSchema } from "../../domain/pricing.js";
import { subscriptionPeriodEnd } from "../../domain/subscription-period.js";
import { lockPricing, lockSubscription } from "../../infrastructure/postgres/catalog-lock.js";
import { bankTimeoutMs, type Tbank, validatedPaymentUrl, type BankPayment, type PaymentInitiator } from "../../infrastructure/tbank/tbank.js";
import { reservePurchaseInTransaction } from "../../features/reserve-purchase/reserve-purchase.js";
import { paymentFailure, purchaseSubscriptionSchema, purchaseStatusSchema, type PaymentResult, type PurchaseStatus } from "../../features/purchase-subscription/purchase-subscription.contract.js";
import { paidPeriodCommandSchema } from "../../../membership-entitlements/index.js";
import { endLapsedSubscriptions, endSubscription, inFlightStates, settleConfirmedAttempt } from "../../shared/subscription-outcome.js";
import { attemptKindSchema, type AttemptKind } from "../../domain/subscription-change.js";
import { renewalPriceSnapshot } from "../../domain/subscription-change.js";
import { verifyRecurringConsent } from "../../shared/recurring-consent.js";

const fulfillmentRetryDelayMilliseconds = 60_000;
// Derived from the bank's own timeout, so a caller outlives exactly one honest round-trip.
const inFlightAnswerBudgetMilliseconds = bankTimeoutMs + 2_000;
const inFlightAnswerPollMilliseconds = 200;
// Первая покупка сохраняет привязку, повышение инициирует покупатель, продление — merchant recurring.
const paymentInitiators: Record<AttemptKind, PaymentInitiator> = { initial: "1", upgrade: "2", renewal: "R" };

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
        await endLapsedSubscriptions(tx, accountId, now);
        const current = await tx.billingPurchase.findFirst({ where: { accountId, kind: "initial", lifecycleActive: true, state: { not: "failed" } } });
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
      // A second tab joins an existing attempt and dispatches nothing, so it must not answer from
      // the interim row that carries no payment URL. The caller that did dispatch already settled
      // the row, so it waits for nothing here.
      await this.dispatch(prepared.value);
      await this.awaitBankAnswer(prepared.value);
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
      if (row.state === "prepared") { await this.dispatch(row.id); return { ok: true, value: true }; }
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
      const accepted = await this.accept(payment);
      // Init прошёл, Charge ещё не вызывался: только доказанное NEW разрешает завершить ту же попытку.
      if (accepted.ok && row.kind !== "initial" && !row.chargeCalled && payment.Status === "NEW") await this.chargeSaved(row.id, paymentId);
      return accepted;
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

  /**
   * Due-продление: сериализованный gate и durable attempt до любого обращения к банку.
   * Отсутствие пригодной привязки завершает расписание, операторская причина только блокирует.
   */
  async renew(limit = 20): Promise<PaymentResult<{ inspected: number; started: number; blocked: number; closed: number }>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return paymentFailure("invalid_request");
    const { prisma } = this.dependencies;
    if (!this.dependencies.bank) return paymentFailure("method_unavailable");
    try {
      const due = await prisma.billingSubscription.findMany({
        where: { state: "active", paidUntil: { lte: this.clock() } }, orderBy: { paidUntil: "asc" }, take: limit });
      let started = 0, blocked = 0;
      for (const subscription of due) {
        const prepared = await this.prepareRenewal(subscription.id);
        if (prepared.attemptRef) { await this.dispatch(prepared.attemptRef); started += 1; }
        else if (prepared.blocked) blocked += 1;
      }
      // Закончившийся оплаченный срок без продления освобождает Account для новой покупки.
      const lapsed = await prisma.billingSubscription.findMany({
        where: { state: { not: "ended" }, paidUntil: { lte: this.clock() } }, orderBy: { paidUntil: "asc" }, take: limit });
      let closed = 0;
      for (const subscription of lapsed) closed += await prisma.$transaction(async tx => {
        const now = this.clock();
        await lockSubscription(tx, subscription.id);
        await endLapsedSubscriptions(tx, subscription.accountId, now);
        return (await tx.billingSubscription.findUniqueOrThrow({ where: { id: subscription.id } })).state === "ended" ? 1 : 0;
      });
      return { ok: true, value: { inspected: due.length, started, blocked, closed } };
    } catch { return paymentFailure("dependency_unavailable"); }
  }

  /** Одна отправка одной durable попытки; отмена и отзыв привязки проверяются под тем же замком. */
  // Waits out another caller's bank round-trip. An abandoned attempt cannot hang this caller: the
  // budget runs out and the current row is returned, for reconciliation to settle later.
  private async awaitBankAnswer(attemptRef: string): Promise<void> {
    const deadline = Date.now() + inFlightAnswerBudgetMilliseconds;
    for (;;) {
      const row = await this.dependencies.prisma.billingPurchase.findUnique({ where: { id: attemptRef }, select: { state: true } });
      if (row?.state !== "sent" || Date.now() >= deadline) return;
      await delay(inFlightAnswerPollMilliseconds);
    }
  }

  async dispatch(attemptRef: string): Promise<void> {
    const { prisma, bank } = this.dependencies;
    if (!bank) return;
    const row = await prisma.$transaction(async tx => {
      await lockPricing(tx);
      const row = await tx.billingPurchase.findUnique({ where: { id: attemptRef } });
      if (!row || row.state !== "prepared" || row.terminalRef !== bank.config.terminalKey || row.environment !== bank.config.environment) return undefined;
      const now = this.clock();
      if (row.subscriptionRef) {
        await lockSubscription(tx, row.subscriptionRef);
        const subscription = await tx.billingSubscription.findUnique({ where: { id: row.subscriptionRef } });
        // Отмена останавливает только продление; принятое повышение оплачивает действующий срок.
        const schedulable = row.kind === "renewal" ? subscription?.state === "active" : subscription?.state !== "ended";
        if (!subscription || !schedulable || !subscription.bindingCiphertext || subscription.bindingRevokedAt !== null) {
          // Отмена или отзыв привязки до отправки: внешнего эффекта нет, попытка закрывается.
          await tx.billingPurchase.update({ where: { id: attemptRef }, data: { state: "failed", updatedAt: now } });
          return undefined;
        }
      }
      await tx.billingPurchase.update({ where: { id: attemptRef }, data: { state: "sent", updatedAt: now } });
      if (row.kind === "initial") await tx.billingPromoReservation.update({ where: { purchaseRef: attemptRef }, data: { state: "sent" } });
      return row;
    });
    if (!row) return;
    try {
      const snapshot = priceSnapshotSchema.parse(row.snapshot);
      const contact = z.object({ emailCiphertext: z.string() }).parse(row.contact);
      const email = z.email().parse(bank.openBinding(`${row.id}:contact`, contact.emailCiphertext));
      const initiator = paymentInitiators[attemptKindSchema.parse(row.kind)];
      const payment = await bank.init({ orderId: row.id, accountId: row.accountId, amount: Number(row.amountKopecks), name: snapshot.offer.name, email, initiator });
      const accepted = await this.accept(payment, row.kind === "initial" ? payment.PaymentURL : undefined);
      if (!accepted.ok) throw new Error("Bank initialization fact rejected");
      if (row.kind !== "initial" && !await this.chargeSaved(row.id, payment.PaymentId)) throw new Error("Saved method charge is unresolved");
    } catch {
      await prisma.$transaction(async tx => {
        await lockPricing(tx);
        const changed = await tx.billingPurchase.updateMany({ where: { id: row.id, state: { in: ["sent", "pending"] } }, data: { state: "unknown", updatedAt: this.clock() } });
        if (changed.count && row.kind === "initial") await tx.billingPromoReservation.update({ where: { purchaseRef: attemptRef }, data: { state: "unknown" } });
      });
    }
  }

  private async prepareRenewal(subscriptionRef: string): Promise<{ attemptRef?: string; blocked?: boolean }> {
    const { prisma, contact, grants, bank } = this.dependencies;
    if (!bank) return { blocked: true };
    const current = await prisma.billingSubscription.findUnique({ where: { id: subscriptionRef } });
    if (!current || current.state !== "active") return {};
    const [legacy, verified, consented] = await Promise.all([
      grants.readLegacyClassification(current.accountId), contact.read(current.accountId),
      verifyRecurringConsent(contact, current.accountId, current.consent),
    ]);
    if (!legacy.ok || !verified.ok) return { blocked: true };
    const verifiedContact = verified.contact;
    const snapshot = renewalPriceSnapshot(current.snapshot, current.pendingChange);
    const amountKopecks = snapshot.renewalPriceKopecks;
    const withinLimits = amountKopecks >= bank.config.minimumKopecks && amountKopecks <= bank.config.maximumKopecks;
    return await prisma.$transaction(async (tx): Promise<{ attemptRef?: string; blocked?: boolean }> => {
      await lockPricing(tx);
      await lockSubscription(tx, subscriptionRef);
      const now = this.clock();
      const row = await tx.billingSubscription.findUnique({ where: { id: subscriptionRef } });
      if (!row || row.state !== "active" || row.paidUntil > now) return {};
      if (await tx.billingPurchase.count({ where: { subscriptionRef, state: { in: [...inFlightStates] } } })) return {};
      if (!row.bindingCiphertext || !row.bindingRef || row.bindingRevokedAt !== null) {
        // Отозванная или неполученная привязка закрывает расписание вместе с оплаченным сроком.
        await endSubscription(tx, subscriptionRef, "payment_method_unavailable", now);
        return {};
      }
      // Классификация, согласие, контакт и границы терминала — операторский разбор, не отказ покупателя.
      if (!legacy.recurringAllowed || !consented || !verifiedContact || !withinLimits) return { blocked: true };
      const attemptRef = randomUUID();
      await tx.billingPurchase.create({ data: {
        id: attemptRef, accountId: row.accountId, subscriptionRef, kind: "renewal", periodIndex: row.periodIndex + 1,
        lifecycleActive: false, state: "prepared", environment: bank.config.environment, terminalRef: bank.config.terminalKey,
        amountKopecks: BigInt(amountKopecks), snapshot, acceptance: { renewalOfRevision: row.revision },
        // Попытка удерживает выбранный способ: более поздняя смена карты её не переписывает.
        bindingCiphertext: bank.sealBinding(attemptRef, bank.openBinding(row.bindingRef, row.bindingCiphertext)),
        contact: { revision: verifiedContact.revision, verifiedAt: verifiedContact.verifiedAt, emailCiphertext: bank.sealBinding(`${attemptRef}:contact`, verifiedContact.email) },
        fiscalization: "pending", createdAt: now, updatedAt: now,
      } });
      return { attemptRef };
    });
  }

  private async chargeSaved(attemptRef: string, paymentId: string): Promise<boolean> {
    const { prisma, bank } = this.dependencies;
    if (!bank) return false;
    const prepared = await prisma.$transaction(async tx => {
      const row = await tx.billingPurchase.findUnique({ where: { id: attemptRef } });
      if (!row?.subscriptionRef || row.chargeCalled || !row.bindingCiphertext || !["sent", "pending"].includes(row.state)) return undefined;
      // CHARGE_CALLED сохраняется до сети: даже NEW после него не разрешает повторное списание.
      await tx.billingPurchase.update({ where: { id: attemptRef }, data: { chargeCalled: true, updatedAt: this.clock() } });
      return bank.openBinding(row.id, row.bindingCiphertext);
    });
    if (!prepared) return false;
    return (await this.accept(await bank.charge({ paymentId, rebillId: prepared }))).ok;
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
        const now = this.clock();
        if (row.subscriptionRef) await lockSubscription(tx, row.subscriptionRef);
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
          if (payment.RebillId && !row.bindingCiphertext && payment.Success && payment.ErrorCode === "0") {
            const bindingCiphertext = bank.sealBinding(row.id, payment.RebillId);
            await tx.billingPurchase.update({ where: { id: row.id }, data: { bindingCiphertext } });
            const subscription = row.subscriptionRef ? await tx.billingSubscription.findUnique({ where: { id: row.subscriptionRef } }) : null;
            // Поздняя привязка дополняет способ оплаты и не включает отменённое продление.
            if (subscription && subscription.state !== "ended" && !subscription.bindingCiphertext)
              await tx.billingSubscription.update({ where: { id: subscription.id },
                data: { bindingRef: row.id, bindingCiphertext, revision: subscription.revision + 1, updatedAt: now } });
          }
          return { ok: true, value: true };
        }
        if (row.state === "failed") return payment.Status === "CONFIRMED" ? paymentFailure("invalid_notification") : { ok: true, value: true };
        const common = { paymentId: payment.PaymentId, updatedAt: now,
          ...(payment.RebillId ? { bindingCiphertext: bank.sealBinding(row.id, payment.RebillId) } : {}),
        };
        if (payment.Status === "CONFIRMED") {
          if (!payment.Success || payment.ErrorCode !== "0") return paymentFailure("invalid_notification");
          // The first durably verified CONFIRMED starts the full period; replays returned above.
          const paidAt = now;
          const eventRef = randomUUID();
          const period = await settleConfirmedAttempt(tx, { ...row, bindingCiphertext: common.bindingCiphertext ?? row.bindingCiphertext }, paidAt);
          const snapshot = period.snapshot;
          await tx.billingPurchase.update({ where: { id: row.id }, data: { ...common, state: "confirmed", confirmedAt: paidAt, periodEndsAt: period.endsAt, paymentUrl: null } });
          if (row.kind === "initial") await tx.billingPromoReservation.update({ where: { purchaseRef: row.id }, data: { state: "confirmed" } });
          await tx.billingPaymentEvent.create({ data: { id: eventRef, purchaseRef: row.id, kind: "payment_confirmed", payload: { accountId: row.accountId, amountKopecks: payment.Amount, periodRef: row.id, startsAt: period.startsAt.toISOString(), endsAt: period.endsAt.toISOString(), snapshot }, occurredAt: paidAt, recordedAt: now } });
          for (const capability of snapshot.offer.benefits) {
            const term = snapshot.offer.benefitPeriods?.find(value => value.capability === capability);
            // Право без собственного срока действует ровно оплаченный период; собственный срок считается от его начала.
            const validUntil = term === undefined ? period.endsAt.toISOString()
              : term.months === null ? null : subscriptionPeriodEnd(period.startsAt, term.months).toISOString();
            const grantEventRef = randomUUID();
            const command = { eventRef: grantEventRef, periodRef: `${row.id}:${capability}`, accountId: row.accountId, revision: 1, revoked: false,
              terms: { capabilities: [capability], startsAt: period.startsAt.toISOString(), validUntil, reason: `Confirmed payment ${row.id}` } };
            await tx.billingFulfillment.create({ data: { eventRef: grantEventRef, purchaseRef: row.id, payload: command } });
          }
        } else if (["REJECTED", "AUTH_FAIL", "CANCELED", "DEADLINE_EXPIRED", "REVERSED"].includes(payment.Status)) {
          await tx.billingPurchase.update({ where: { id: row.id }, data: { ...common, state: "failed", lifecycleActive: false, paymentUrl: null } });
          if (row.kind === "initial") await tx.billingPromoReservation.update({ where: { purchaseRef: row.id }, data: { state: "failed" } });
          // Однозначный отказ по расписанию завершает продление без automatic retry и без неоплаченного grace.
          if (row.kind === "renewal" && row.subscriptionRef) await endSubscription(tx, row.subscriptionRef, "renewal_declined", now);
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
