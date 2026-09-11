import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BillingPrisma, BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { BillingContact } from "../../../accounts/index.js";
import type { AccessGrants } from "../../../membership-entitlements/index.js";
import { offerSchema, optionSchema, priceSnapshotSchema, type PriceSnapshot } from "../../domain/pricing.js";
import {
  changePlanSchema, pendingChangeSchema, planSubscriptionChange, sameChangeConditions,
  subscriptionSnapshotSchema, subscriptionViewSchema, type ChangePlan, type SubscriptionView,
} from "../../domain/subscription-change.js";
import {
  type CurrentBilling,
  cancelChangeSchema, cancelRenewalSchema, changeOptionSchema, changeQuoteResultSchema,
  quoteChangeSchema, resumeRenewalSchema, type ChangeQuoteResult, type ChangeResult,
} from "../../features/manage-subscription/manage-subscription.contract.js";
import { changeMethodSchema, methodFlowSchema, revokeMethodSchema, type MethodFlowResult } from "../../features/change-payment-method/change-payment-method.contract.js";
import { paymentFailure, type PaymentResult } from "../../features/purchase-subscription/purchase-subscription.contract.js";
import { lockPricing, lockSubscription } from "../../infrastructure/postgres/catalog-lock.js";
import type { Tbank } from "../../infrastructure/tbank/tbank.js";
import { lifecycleWindow, renewalCancelledSourceRef } from "../../domain/notice.js";
import { recordBillingNotice, supersedeRenewalReminders } from "../../shared/record-notice.js";
import type { BillingNotices } from "../billing-notices/billing-notices.js";
import { commandFingerprint } from "../../shared/command-fingerprint.js";
import { acceptRecurringConsent } from "../../shared/recurring-consent.js";
import { advanceSubscription, inFlightStates } from "../../shared/subscription-outcome.js";
import type { BillingPayments } from "../billing-payments/billing-payments.js";

const changeQuoteLifetimeMs = 15 * 60 * 1_000;
const changeReceiptSchema = z.strictObject({ subscription: subscriptionViewSchema, attemptRef: z.uuid().nullable() });
type SubscriptionRow = Awaited<ReturnType<BillingPrisma["billingSubscription"]["findUniqueOrThrow"]>>;

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly contact: Pick<BillingContact, "read" | "readConsent">;
  readonly grants: Pick<AccessGrants, "readLegacyClassification" | "readOwnAccess">;
  readonly payments: Pick<BillingPayments, "dispatch" | "status" | "history">;
  readonly notices: Pick<BillingNotices, "readNotices">;
  readonly bank: Tbank | undefined;
  readonly clock?: () => Date;
}

/**
 * Владельческие команды действующей подписки: отмена и возобновление расписания, смена варианта
 * и способа оплаты. Банковский исход попытки остаётся за общим payment path.
 */
export class BillingSubscriptions {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: Dependencies) { this.clock = dependencies.clock ?? (() => new Date()); }

  /**
   * Кабинет: действующая подписка, собственные основания доступа, история списаний и служебные
   * поводы. Основания и история отвечают на вопрос «что доступно, по какому основанию и до
   * какого срока» отдельно от расписания списаний.
   */
  async read(accountId: string): Promise<PaymentResult<CurrentBilling>> {
    if (!z.uuid().safeParse(accountId).success) return paymentFailure("forbidden");
    try {
      const [subscription, notices, access, payments] = await Promise.all([
        this.currentSubscription(accountId),
        this.dependencies.notices.readNotices(accountId),
        this.dependencies.grants.readOwnAccess(accountId),
        this.dependencies.payments.history(accountId),
      ]);
      if (!access.ok || !payments.ok) return paymentFailure("dependency_unavailable");
      return { ok: true, value: { subscription, notices, grounds: access.value.grounds, payments: payments.value } };
    } catch { return paymentFailure("dependency_unavailable"); }
  }

  private async currentSubscription(accountId: string): Promise<SubscriptionView | null> {
    const row = await this.dependencies.prisma.billingSubscription.findFirst({ where: { accountId, state: { not: "ended" } } });
    return row ? await subscriptionView(this.dependencies.prisma, row) : null;
  }

  async cancel(accountId: string, input: unknown): Promise<PaymentResult<SubscriptionView>> {
    const parsed = cancelRenewalSchema.safeParse(input);
    if (!parsed.success) return paymentFailure("invalid_request");
    const command = parsed.data;
    return this.transition(accountId, command.operationId, commandFingerprint("cancel", command), async (tx, row, now) => {
      if (row.revision !== command.expectedRevision) return paymentFailure("revision_conflict");
      if (row.state !== "active") return paymentFailure("revision_conflict");
      // Уже отправленный платёж не отзывается командой отмены; он сверяется своим путём.
      const revision = await advanceSubscription(tx, row, { state: "canceled", pendingChange: {} }, "renewal_canceled", { paidUntil: row.paidUntil.toISOString() }, now);
      // Списания больше не будет: напоминание о нём перестаёт быть актуальным до любой отправки.
      await supersedeRenewalReminders(tx, row.id, now);
      await recordBillingNotice(tx, { kind: "renewal_cancelled", accountId, sourceRef: renewalCancelledSourceRef(row.id, revision),
        subscriptionRef: row.id, title: subscriptionSnapshotSchema.parse(row.snapshot).offer.name,
        dueAt: row.paidUntil, ...lifecycleWindow(now) }, now);
      return { ok: true, value: true };
    });
  }

  async resume(accountId: string, input: unknown): Promise<PaymentResult<SubscriptionView>> {
    const parsed = resumeRenewalSchema.safeParse(input);
    if (!parsed.success) return paymentFailure("invalid_request");
    const command = parsed.data;
    const contact = await this.dependencies.contact.read(accountId);
    if (!contact.ok) return paymentFailure("dependency_unavailable");
    if (!contact.contact) return paymentFailure("contact_required");
    const consent = await acceptRecurringConsent(this.dependencies.contact, accountId, command.operationId, command.consentEvidenceRefs, contact.documents);
    if (!consent) return paymentFailure("consent_required");
    // Возобновление снова включает списания, поэтому проходит ту же проверку, что и покупка.
    const legacy = await this.dependencies.grants.readLegacyClassification(accountId);
    if (!legacy.ok) return paymentFailure("dependency_unavailable");
    if (!legacy.recurringAllowed) return paymentFailure("legacy_review_required");
    return this.transition(accountId, command.operationId, commandFingerprint("resume", command), async (tx, row, now) => {
      if (row.revision !== command.expectedRevision) return paymentFailure("revision_conflict");
      // Возобновляется только действующий оплаченный срок на прежних условиях.
      if (row.state !== "canceled" || row.paidUntil <= now) return paymentFailure("not_found");
      if (!row.bindingCiphertext || row.bindingRevokedAt !== null) return paymentFailure("method_unavailable");
      await advanceSubscription(tx, row, { state: "active", consent }, "renewal_resumed", { paidUntil: row.paidUntil.toISOString() }, now);
      return { ok: true, value: true };
    });
  }

  async quoteChange(accountId: string, input: unknown): Promise<PaymentResult<ChangeQuoteResult>> {
    const parsed = quoteChangeSchema.safeParse(input);
    if (!parsed.success) return paymentFailure("invalid_request");
    if (!z.uuid().safeParse(accountId).success) return paymentFailure("forbidden");
    const command = parsed.data;
    const digest = commandFingerprint("quoteChange", command);
    try {
      return await this.dependencies.prisma.$transaction(async (tx): Promise<PaymentResult<ChangeQuoteResult>> => {
        const now = this.clock();
        const previous = await tx.billingChangeQuote.findUnique({ where: { accountId_operationId: { accountId, operationId: command.operationId } } });
        if (previous) return previous.fingerprint === digest
          ? { ok: true, value: quoteResult(previous.id, previous.baseRevision, previous.plan, previous.expiresAt) } : paymentFailure("operation_conflict");
        await lockPricing(tx);
        const row = await tx.billingSubscription.findFirst({ where: { accountId, state: { not: "ended" } } });
        if (!row) return paymentFailure("not_found");
        if (row.revision !== command.expectedRevision) return paymentFailure("revision_conflict");
        const plan = await this.planChange(tx, row, command.paymentOptionId, now);
        if (!plan.ok) return plan;
        // У отменённого расписания нет следующего периода: остаётся только повышение текущего срока.
        if (plan.value.kind === "scheduled" && row.state !== "active") return paymentFailure("revision_conflict");
        const changeQuoteRef = randomUUID();
        const expiresAt = new Date(now.getTime() + changeQuoteLifetimeMs);
        await tx.billingChangeQuote.create({ data: { id: changeQuoteRef, subscriptionRef: row.id, accountId,
          operationId: command.operationId, fingerprint: digest, baseRevision: row.revision, plan: plan.value, createdAt: now, expiresAt } });
        return { ok: true, value: { changeQuoteRef, baseRevision: row.revision, plan: plan.value, expiresAt: expiresAt.toISOString() } };
      });
    } catch { return paymentFailure("dependency_unavailable"); }
  }

  async change(accountId: string, input: unknown): Promise<PaymentResult<ChangeResult>> {
    const parsed = changeOptionSchema.safeParse(input);
    if (!parsed.success) return paymentFailure("invalid_request");
    if (!z.uuid().safeParse(accountId).success) return paymentFailure("forbidden");
    const command = parsed.data;
    const digest = commandFingerprint("change", command);
    const { prisma, bank, payments } = this.dependencies;
    // Контакт чека читается до открытия транзакции: замки не удерживаются на чужом чтении.
    const verified = await this.dependencies.contact.read(accountId);
    let accepted: z.infer<typeof changeReceiptSchema> | undefined;
    try {
      const previous = await prisma.billingSubscriptionCommand.findUnique({ where: { accountId_operationId: { accountId, operationId: command.operationId } } });
      if (previous) {
        if (previous.fingerprint !== digest) return paymentFailure("operation_conflict");
        accepted = changeReceiptSchema.parse(previous.result);
      }
      accepted ??= await prisma.$transaction(async tx => {
        const now = this.clock();
        await lockPricing(tx);
        const quote = await tx.billingChangeQuote.findFirst({ where: { id: command.changeQuoteRef, accountId } });
        if (!quote) throw new CommandFailure("not_found");
        if (quote.expiresAt <= now) throw new CommandFailure("quote_expired");
        const plan = changePlanSchema.parse(quote.plan);
        await lockSubscription(tx, quote.subscriptionRef);
        const row = await tx.billingSubscription.findUniqueOrThrow({ where: { id: quote.subscriptionRef } });
        if (row.revision !== command.expectedRevision || row.revision !== quote.baseRevision) throw new CommandFailure("revision_conflict");
        if (plan.kind === "scheduled" && row.state !== "active") throw new CommandFailure("revision_conflict");
        // Каталог мог измениться после расчёта: согласие относится к конкретным условиям.
        // Сама доплата остаётся принятой суммой расчёта в пределах его срока действия.
        const current = await this.planChange(tx, row, plan.snapshot.paymentOption.id, now);
        if (!current.ok) throw new CommandFailure(current.error.code);
        if (current.value.kind !== plan.kind || !sameChangeConditions(current.value.snapshot, plan.snapshot))
          throw new CommandFailure("quote_changed");
        if (plan.kind === "scheduled") {
          // Отправленная попытка уже несёт прежние условия следующего периода.
          if (await tx.billingPurchase.count({ where: { subscriptionRef: row.id, kind: "renewal", state: { in: inFlightStates } } }))
            throw new CommandFailure("payment_in_progress");
          await advanceSubscription(tx, row, { pendingChange: { snapshot: plan.snapshot, acceptedAt: now.toISOString(), changeQuoteRef: quote.id } },
            "change_scheduled", { paymentOptionId: plan.snapshot.paymentOption.id, effectiveAt: plan.effectiveAt }, now);
          // Следующий период меняет состав и сумму: расписание выпустит напоминание с новыми условиями.
          await supersedeRenewalReminders(tx, row.id, now);
          const value = { subscription: await subscriptionView(tx, await tx.billingSubscription.findUniqueOrThrow({ where: { id: row.id } })), attemptRef: null };
          await tx.billingSubscriptionCommand.create({ data: { accountId, operationId: command.operationId, fingerprint: digest, result: value, createdAt: now } });
          return value;
        }
        if (!bank) throw new CommandFailure("method_unavailable");
        if (!row.bindingCiphertext || !row.bindingRef || row.bindingRevokedAt !== null) throw new CommandFailure("method_unavailable");
        if (await tx.billingPurchase.count({ where: { subscriptionRef: row.id, state: { in: inFlightStates } } })) throw new CommandFailure("payment_in_progress");
        if (!verified.ok) throw new CommandFailure("dependency_unavailable");
        if (!verified.contact) throw new CommandFailure("contact_required");
        const attemptRef = randomUUID();
        await tx.billingPurchase.create({ data: {
          id: attemptRef, accountId, subscriptionRef: row.id, kind: "upgrade", periodIndex: row.periodIndex, lifecycleActive: false,
          state: "prepared", environment: bank.config.environment, terminalRef: bank.config.terminalKey,
          amountKopecks: BigInt(plan.topUpKopecks), snapshot: plan.snapshot, acceptance: { changeQuoteRef: quote.id, upgradeOfRevision: row.revision },
          bindingCiphertext: bank.sealBinding(attemptRef, bank.openBinding(row.bindingRef, row.bindingCiphertext)),
          contact: { revision: verified.contact.revision, verifiedAt: verified.contact.verifiedAt, emailCiphertext: bank.sealBinding(`${attemptRef}:contact`, verified.contact.email) },
          fiscalization: "pending", createdAt: now, updatedAt: now,
        } });
        const value = { subscription: await subscriptionView(tx, row), attemptRef };
        await tx.billingSubscriptionCommand.create({ data: { accountId, operationId: command.operationId, fingerprint: digest, result: value, createdAt: now } });
        return value;
      });
    } catch (error) { return error instanceof CommandFailure ? paymentFailure(error.code) : paymentFailure("dependency_unavailable"); }
    if (accepted.attemptRef) await payments.dispatch(accepted.attemptRef);
    const payment = accepted.attemptRef ? await payments.status(accountId, accepted.attemptRef) : undefined;
    const current = await this.currentSubscription(accountId).catch(() => null);
    return { ok: true, value: {
      subscription: current ?? accepted.subscription,
      payment: payment?.ok ? payment.value : null,
    } };
  }

  async cancelChange(accountId: string, input: unknown): Promise<PaymentResult<SubscriptionView>> {
    const parsed = cancelChangeSchema.safeParse(input);
    if (!parsed.success) return paymentFailure("invalid_request");
    const command = parsed.data;
    return this.transition(accountId, command.operationId, commandFingerprint("cancelChange", command), async (tx, row, now) => {
      if (row.revision !== command.expectedRevision) return paymentFailure("revision_conflict");
      if (!pendingChangeSchema.safeParse(row.pendingChange).success) return paymentFailure("not_found");
      // Отправленная попытка уже несёт согласованные условия следующего периода.
      if (await tx.billingPurchase.count({ where: { subscriptionRef: row.id, kind: "renewal", state: { in: inFlightStates } } })) return paymentFailure("payment_in_progress");
      await advanceSubscription(tx, row, { pendingChange: {} }, "change_canceled", {}, now);
      await supersedeRenewalReminders(tx, row.id, now);
      return { ok: true, value: true };
    });
  }

  async changeMethod(accountId: string, input: unknown): Promise<PaymentResult<MethodFlowResult>> {
    const parsed = changeMethodSchema.safeParse(input);
    if (!parsed.success) return paymentFailure("invalid_request");
    if (!z.uuid().safeParse(accountId).success) return paymentFailure("forbidden");
    const command = parsed.data;
    const digest = commandFingerprint("changeMethod", command);
    const { prisma, bank } = this.dependencies;
    if (!bank?.config.cardBinding) return paymentFailure("method_unavailable");
    let flowRef: string;
    try {
      const previous = await prisma.billingPaymentMethodFlow.findUnique({ where: { accountId_operationId: { accountId, operationId: command.operationId } } });
      if (previous) return previous.fingerprint === digest ? { ok: true, value: flowResult(previous) } : paymentFailure("operation_conflict");
      const prepared = await prisma.$transaction(async (tx): Promise<PaymentResult<string>> => {
        const now = this.clock();
        const row = await tx.billingSubscription.findFirst({ where: { accountId, state: { not: "ended" } } });
        if (!row) return paymentFailure("not_found");
        if (row.revision !== command.expectedRevision) return paymentFailure("revision_conflict");
        await lockSubscription(tx, row.id);
        if (await tx.billingPaymentMethodFlow.count({ where: { subscriptionRef: row.id, state: "started" } })) return paymentFailure("operation_conflict");
        const id = randomUUID();
        // Сессия привязки существует локально до обращения к банку; её ключ приходит ответом.
        await tx.billingPaymentMethodFlow.create({ data: { id, subscriptionRef: row.id, accountId, operationId: command.operationId,
          fingerprint: digest, environment: bank.config.environment, terminalRef: bank.config.terminalKey, requestKey: id,
          state: "started", createdAt: now, updatedAt: now } });
        return { ok: true, value: id };
      });
      if (!prepared.ok) return prepared;
      flowRef = prepared.value;
    } catch { return paymentFailure("dependency_unavailable"); }
    try {
      const session = await bank.addCard(accountId);
      await prisma.billingPaymentMethodFlow.update({ where: { id: flowRef }, data: { requestKey: session.requestKey, formUrl: session.formUrl, updatedAt: this.clock() } });
    } catch {
      await prisma.billingPaymentMethodFlow.updateMany({ where: { id: flowRef, state: "started" }, data: { state: "rejected", observedStatus: "session_unavailable", updatedAt: this.clock() } });
      return paymentFailure("provider_unavailable");
    }
    const row = await prisma.billingPaymentMethodFlow.findUniqueOrThrow({ where: { id: flowRef } });
    return { ok: true, value: flowResult(row) };
  }

  async revokeMethod(accountId: string, input: unknown): Promise<PaymentResult<SubscriptionView>> {
    const parsed = revokeMethodSchema.safeParse(input);
    if (!parsed.success) return paymentFailure("invalid_request");
    const command = parsed.data;
    return this.transition(accountId, command.operationId, commandFingerprint("revokeMethod", command), async (tx, row, now) => {
      if (row.revision !== command.expectedRevision) return paymentFailure("revision_conflict");
      if (row.bindingRef !== command.paymentMethodRef) return paymentFailure("not_found");
      if (row.bindingRevokedAt !== null) return paymentFailure("revision_conflict");
      // Запрет распространяется на новые отправки; уже отправленная попытка видна отдельно.
      await advanceSubscription(tx, row, { bindingRevokedAt: now }, "method_revoked", { methodRef: command.paymentMethodRef }, now);
      // Списывать нечем: обещать дату и сумму следующего списания больше нельзя.
      await supersedeRenewalReminders(tx, row.id, now);
      return { ok: true, value: true };
    });
  }

  /** Серверная сверка сессий привязки: новый способ применяется только по доказанному token. */
  async reconcileMethodFlows(limit = 20): Promise<PaymentResult<{ inspected: number; applied: number }>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return paymentFailure("invalid_request");
    const { prisma, bank } = this.dependencies;
    if (!bank?.config.cardBinding) return paymentFailure("method_unavailable");
    try {
      const rows = await prisma.billingPaymentMethodFlow.findMany({ where: { state: "started", environment: bank.config.environment,
        terminalRef: bank.config.terminalKey }, orderBy: { createdAt: "asc" }, take: limit });
      let applied = 0;
      for (const row of rows) {
        const now = this.clock();
        if (row.requestKey === row.id) {
          // Ответ банка потерян: локальная сессия закрывается, новая начинается отдельной командой.
          await prisma.billingPaymentMethodFlow.updateMany({ where: { id: row.id, state: "started" }, data: { state: "rejected", observedStatus: "no_bank_session", updatedAt: now } });
          continue;
        }
        let observed: Awaited<ReturnType<Tbank["addCardState"]>>;
        try { observed = await bank.addCardState(row.requestKey); } catch { continue; }
        if (!observed.success || observed.errorCode !== "0") {
          await prisma.billingPaymentMethodFlow.updateMany({ where: { id: row.id, state: "started" }, data: { state: "rejected", observedStatus: observed.status, updatedAt: now } });
          continue;
        }
        if (!observed.rebillId) continue;
        const rebillId = observed.rebillId;
        applied += await prisma.$transaction(async tx => {
          await lockSubscription(tx, row.subscriptionRef);
          const flow = await tx.billingPaymentMethodFlow.findUniqueOrThrow({ where: { id: row.id } });
          if (flow.state !== "started") return 0;
          const subscription = await tx.billingSubscription.findUniqueOrThrow({ where: { id: row.subscriptionRef } });
          if (subscription.state === "ended") {
            await tx.billingPaymentMethodFlow.update({ where: { id: row.id }, data: { state: "rejected", observedStatus: "subscription_ended", updatedAt: now } });
            return 0;
          }
          // Новая привязка применяется к следующим разрешённым попыткам и не включает отменённое продление.
          await tx.billingSubscription.update({ where: { id: subscription.id }, data: { bindingRef: row.id,
            bindingCiphertext: bank.sealBinding(row.id, rebillId), bindingRevokedAt: null, revision: subscription.revision + 1, updatedAt: now } });
          await tx.billingSubscriptionEvent.create({ data: { id: randomUUID(), subscriptionRef: subscription.id, kind: "method_changed",
            revision: subscription.revision + 1, payload: { flowRef: row.id }, occurredAt: now, recordedAt: now } });
          await tx.billingPaymentMethodFlow.update({ where: { id: row.id }, data: { state: "completed", observedStatus: observed.status, appliedBindingRef: row.id, updatedAt: now } });
          return 1;
        });
      }
      return { ok: true, value: { inspected: rows.length, applied } };
    } catch { return paymentFailure("dependency_unavailable"); }
  }

  private async planChange(tx: BillingPrisma, row: SubscriptionRow, paymentOptionId: string, now: Date): Promise<PaymentResult<ChangePlan>> {
    const { bank } = this.dependencies;
    const target = await tx.billingPaymentOption.findUnique({ where: { id: paymentOptionId }, include: { offer: true } });
    if (!target || target.archived || target.offer.archived) return paymentFailure("not_found");
    const current = subscriptionSnapshotSchema.parse(row.snapshot);
    if (target.id === current.paymentOption.id && target.revision === current.paymentOption.revision) return paymentFailure("invalid_request");
    const snapshot: PriceSnapshot = priceSnapshotSchema.parse({
      offer: offerSchema.parse({ id: target.offer.id, name: target.offer.name, revision: target.offer.revision, benefits: target.offer.benefits,
        archived: target.offer.archived, ...(Array.isArray(target.offer.benefitPeriods) && target.offer.benefitPeriods.length > 0 ? { benefitPeriods: target.offer.benefitPeriods } : {}) }),
      paymentOption: optionSchema.parse({ id: target.id, offerId: target.offerId, revision: target.revision, months: target.months, mode: target.mode, priceKopecks: Number(target.priceKopecks), archived: target.archived }),
      // Смена варианта не получает новую публичную скидку: применяется обычная цена.
      promotion: null, currency: current.currency, timezone: current.timezone,
      firstPriceKopecks: Number(target.priceKopecks), renewalPriceKopecks: Number(target.priceKopecks),
    });
    const plan = planSubscriptionChange({ currentMonths: current.paymentOption.months, targetMonths: target.months,
      targetPriceKopecks: Number(target.priceKopecks), paidPeriodKopecks: Number(row.periodAmountKopecks),
      periodStartsAt: row.periodStartsAt, paidUntil: row.paidUntil, now });
    if (plan.kind === "scheduled") return { ok: true, value: { kind: "scheduled", snapshot,
      nextPriceKopecks: Number(target.priceKopecks), effectiveAt: row.paidUntil.toISOString() } };
    if (!bank) return paymentFailure("method_unavailable");
    // Границы терминала подтверждены capability и не выдумываются в коде.
    if (plan.topUpKopecks < bank.config.minimumKopecks || plan.topUpKopecks > bank.config.maximumKopecks) return paymentFailure("unsupported_amount");
    return { ok: true, value: { kind: "upgrade", snapshot, topUpKopecks: plan.topUpKopecks, effectiveAt: now.toISOString() } };
  }

  private async transition(accountId: string, operationId: string, digest: string,
    run: (tx: BillingPrisma, row: SubscriptionRow, now: Date) => Promise<PaymentResult<true>>): Promise<PaymentResult<SubscriptionView>> {
    if (!z.uuid().safeParse(accountId).success) return paymentFailure("forbidden");
    const { prisma } = this.dependencies;
    try {
      const previous = await prisma.billingSubscriptionCommand.findUnique({ where: { accountId_operationId: { accountId, operationId } } });
      if (previous) return previous.fingerprint === digest
        ? { ok: true, value: subscriptionViewSchema.parse(previous.result) } : paymentFailure("operation_conflict");
      return await prisma.$transaction(async (tx): Promise<PaymentResult<SubscriptionView>> => {
        const now = this.clock();
        const existing = await tx.billingSubscriptionCommand.findUnique({ where: { accountId_operationId: { accountId, operationId } } });
        if (existing) return existing.fingerprint === digest
          ? { ok: true, value: subscriptionViewSchema.parse(existing.result) } : paymentFailure("operation_conflict");
        const found = await tx.billingSubscription.findFirst({ where: { accountId, state: { not: "ended" } } });
        if (!found) return paymentFailure("not_found");
        await lockSubscription(tx, found.id);
        const row = await tx.billingSubscription.findUniqueOrThrow({ where: { id: found.id } });
        const result = await run(tx, row, now);
        if (!result.ok) return result;
        const value = await subscriptionView(tx, await tx.billingSubscription.findUniqueOrThrow({ where: { id: row.id } }));
        await tx.billingSubscriptionCommand.create({ data: { accountId, operationId, fingerprint: digest, result: value, createdAt: now } });
        return { ok: true, value };
      });
    } catch { return paymentFailure("dependency_unavailable"); }
  }
}

class CommandFailure extends Error {
  constructor(readonly code: Parameters<typeof paymentFailure>[0]) { super(code); }
}

function quoteResult(changeQuoteRef: string, baseRevision: number, plan: unknown, expiresAt: Date): ChangeQuoteResult {
  return changeQuoteResultSchema.parse({ changeQuoteRef, baseRevision, plan, expiresAt: expiresAt.toISOString() });
}

function flowResult(row: { id: string; state: string; formUrl: string | null; appliedBindingRef: string | null }): MethodFlowResult {
  return methodFlowSchema.parse({ flowRef: row.id, state: row.state, formUrl: row.formUrl, methodRef: row.appliedBindingRef });
}

async function subscriptionView(tx: BillingPrisma, row: SubscriptionRow): Promise<SubscriptionView> {
  const attempt = await tx.billingPurchase.findFirst({ where: { subscriptionRef: row.id, state: { in: inFlightStates } }, orderBy: { createdAt: "desc" } });
  const flow = await tx.billingPaymentMethodFlow.findFirst({ where: { subscriptionRef: row.id, state: "started" } });
  const pending = pendingChangeSchema.safeParse(row.pendingChange);
  return subscriptionViewSchema.parse({
    subscriptionRef: row.id, revision: row.revision, state: row.state, snapshot: subscriptionSnapshotSchema.parse(row.snapshot),
    periodStartsAt: row.periodStartsAt.toISOString(), paidUntil: row.paidUntil.toISOString(),
    periodAmountKopecks: Number(row.periodAmountKopecks), periodIndex: row.periodIndex,
    paymentMethod: row.bindingRef ? { methodRef: row.bindingRef, revoked: row.bindingRevokedAt !== null } : null,
    pendingChange: pending.success ? pending.data : null,
    pendingMethodChange: flow ? { flowRef: flow.id, formUrl: flow.formUrl } : null,
    inFlightPayment: attempt ? { attemptRef: attempt.id, kind: attempt.kind, state: attempt.state } : null,
  });
}
