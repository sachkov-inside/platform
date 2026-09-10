import { z } from "zod";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import type { AccessGrants } from "../../../membership-entitlements/index.js";
import {
  isOwnerReadOperation, ownerAccessFailure, ownerFailure, ownerOperationSchema, ownerPaymentFailure,
  ownerSuccessSchema, type OwnerOperation, type OwnerOutcome, type OwnerResult,
} from "../../domain/owner-operations.js";
import { decideRefund } from "../../features/decide-refund/decide-refund.js";
import { executeRefund, reconcileRefunds } from "../../features/execute-refund/execute-refund.js";
import { listPayments, paymentView, readPayment, refundDecisionViews } from "../../features/read-payments/read-payments.js";
import { commandFingerprint } from "../../shared/command-fingerprint.js";
import { refundTotals } from "../../shared/refund-amounts.js";
import type { Tbank } from "../../infrastructure/tbank/tbank.js";
import type { BillingPayments } from "../billing-payments/billing-payments.js";
import type { BillingPricing } from "../billing-pricing/billing-pricing.js";
import type { BillingSubscriptions } from "../billing-subscriptions/billing-subscriptions.js";

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly pricing: Pick<BillingPricing, "manage">;
  readonly payments: Pick<BillingPayments, "reconcile">;
  readonly subscriptions: Pick<BillingSubscriptions, "cancel">;
  readonly grants: Pick<AccessGrants, "previewBatch" | "applyBatch" | "changeGrant" | "listGrants">;
  readonly bank: Tbank | undefined;
  readonly clock?: () => Date;
}
/**
 * Одна владельческая поверхность billing для admin API и MCP: каталог, платежи и сверка,
 * решения и исполнение возвратов, ручные права. Одинаковые полномочия, идемпотентность и
 * проверка revision в обоих транспортах; MCP не получает больше власти, чем admin endpoint.
 */
export class BillingOperations {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: Dependencies) { this.clock = dependencies.clock ?? (() => new Date()); }

  async execute(actorId: string, input: unknown): Promise<OwnerResult> {
    if (!z.uuid().safeParse(actorId).success) return ownerFailure("forbidden");
    const parsed = ownerOperationSchema.safeParse(input);
    if (!parsed.success) return ownerFailure("invalid_request");
    const command = parsed.data;
    try {
      const permission = await this.dependencies.accounts.checkPermission({ accountId: actorId, permission: "billing:manage" });
      if (!permission.ok) return ownerFailure("dependency_unavailable");
      if (!permission.allowed) return ownerFailure("forbidden");
      if (isOwnerReadOperation(command.operation)) return await this.dispatch(actorId, command);
      const digest = commandFingerprint(command.operation, command);
      const receipt = await this.dependencies.prisma.billingOwnerCommand.findUnique({
        where: { actorId_operationId: { actorId, operationId: command.operationId } } });
      if (receipt !== null) {
        if (receipt.fingerprint !== digest) return ownerFailure("operation_conflict");
        return storedResult(command.operationId, receipt.result);
      }
      const result = await this.dispatch(actorId, command);
      if (!result.ok) return result;
      return await this.record(actorId, command, digest, result);
    } catch { return ownerFailure("dependency_unavailable"); }
  }

  /**
   * Audit применённой команды: он же receipt повтора. Гонка двух одинаковых operationId решается
   * первичным ключом: проигравший возвращает сохранённый результат победителя, а не ошибку.
   */
  private async record(actorId: string, command: OwnerOperation, digest: string,
    result: Extract<OwnerResult, { ok: true }>): Promise<OwnerResult> {
    const data = { actorId, operationId: command.operationId, operation: command.operation, fingerprint: digest,
      targetRef: targetOf(command, result.result), reason: reasonOf(command, result.result), result: result.result, createdAt: this.clock() };
    try {
      await this.dependencies.prisma.billingOwnerCommand.create({ data });
      return result;
    } catch (error) {
      const receipt = await this.dependencies.prisma.billingOwnerCommand.findUnique({
        where: { actorId_operationId: { actorId, operationId: command.operationId } } });
      if (receipt === null) throw error;
      if (receipt.fingerprint !== digest) return ownerFailure("operation_conflict");
      return storedResult(command.operationId, receipt.result);
    }
  }

  /** Сверка незавершённых возвратов принадлежит процессу восстановления, не владельческой команде. */
  reconcileRefunds(limit?: number) {
    return reconcileRefunds({ prisma: this.dependencies.prisma, bank: this.dependencies.bank, clock: this.clock }, limit);
  }

  private async dispatch(actorId: string, command: OwnerOperation): Promise<OwnerResult> {
    const { prisma, grants } = this.dependencies;
    const operationRef = command.operationId;
    switch (command.operation) {
      case "offers.save": case "offers.archive": case "paymentOptions.save": case "paymentOptions.archive":
      case "promotions.save": case "promotions.archive": {
        const result = await this.dependencies.pricing.manage(actorId, command);
        return result.ok
          ? { ok: true, operationRef, result: { outcome: "catalog", value: result.value } } : ownerFailure(result.error.code);
      }
      case "payments.list": return await listPayments(prisma, command);
      case "payments.read": {
        const result = await readPayment(prisma, command.purchaseRef);
        return "result" in result ? { ok: true, operationRef, result: result.result } : result;
      }
      case "payments.reconcile": {
        const row = await prisma.billingPurchase.findUnique({ where: { id: command.purchaseRef }, select: { id: true } });
        if (row === null) return ownerFailure("not_found");
        const reconciled = await this.dependencies.payments.reconcile(command.purchaseRef);
        if (!reconciled.ok) return ownerPaymentFailure(reconciled.error.code);
        const current = await prisma.billingPurchase.findUniqueOrThrow({ where: { id: command.purchaseRef } });
        return { ok: true, operationRef, result: { outcome: "reconciled", value: await paymentView(prisma, current) } };
      }
      case "subscriptions.cancel": {
        // Владелец отменяет продление тем же use case, что и покупатель: правила и revision общие.
        const result = await this.dependencies.subscriptions.cancel(command.accountId,
          { operationId: command.operationId, expectedRevision: command.expectedRevision });
        return result.ok
          ? { ok: true, operationRef, result: { outcome: "subscription", value: result.value } } : ownerPaymentFailure(result.error.code);
      }
      case "refunds.decide": return await decideRefund(prisma, actorId, command, this.clock());
      case "refunds.execute":
        return await executeRefund({ prisma, bank: this.dependencies.bank, clock: this.clock }, actorId, command);
      case "refunds.read": {
        const purchase = await prisma.billingPurchase.findUnique({ where: { id: command.purchaseRef } });
        if (purchase === null) return ownerFailure("not_found");
        const totals = await refundTotals(prisma, purchase.id, purchase.amountKopecks);
        return { ok: true, operationRef, result: { outcome: "refunds", purchaseRef: purchase.id,
          refundedKopecks: totals.refundedKopecks, refundableKopecks: totals.refundableKopecks,
          decisions: await refundDecisionViews(prisma, purchase.id) } };
      }
      case "grants.read": {
        const result = await grants.listGrants(actorId, { accountId: command.accountId });
        return result.ok
          ? { ok: true, operationRef, result: { outcome: "grants", value: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "grants.previewBatch": {
        const { operation: _operation, ...rest } = command;
        const result = await grants.previewBatch(actorId, rest);
        return result.ok
          ? { ok: true, operationRef, result: { outcome: "grantPreview", previewRef: result.previewRef,
            revision: result.revision, expiresAt: result.expiresAt, rows: [...result.rows] } }
          : ownerAccessFailure(result.error.code);
      }
      case "grants.applyBatch": {
        const { operation: _operation, ...rest } = command;
        const result = await grants.applyBatch(actorId, rest);
        return result.ok
          ? { ok: true, operationRef, result: { outcome: "grantBatch", rows: [...result.rows] } } : ownerAccessFailure(result.error.code);
      }
      case "grants.extend": {
        const { operation: _operation, ...rest } = command;
        const result = await grants.changeGrant(actorId, { ...rest, action: "extend" });
        return result.ok
          ? { ok: true, operationRef, result: { outcome: "grant", grantRef: result.grantRef, revision: result.revision } }
          : ownerAccessFailure(result.error.code);
      }
      case "grants.revoke": {
        const { operation: _operation, ...rest } = command;
        const result = await grants.changeGrant(actorId, { ...rest, action: "revoke" });
        return result.ok
          ? { ok: true, operationRef, result: { outcome: "grant", grantRef: result.grantRef, revision: result.revision } }
          : ownerAccessFailure(result.error.code);
      }
      default: { const exhaustive: never = command; throw new Error(`Unknown billing operation ${JSON.stringify(exhaustive)}`); }
    }
  }
}

/**
 * Основание команды. Исполнение возврата наследует основание своего решения, поэтому запись
 * аудита объясняет деньги, а не повторяет имя операции. Для каталога основанием остаётся операция.
 */
function reasonOf(command: OwnerOperation, outcome: OwnerOutcome): string {
  if (outcome.outcome === "refundDecision") return outcome.value.reason;
  return "reason" in command ? command.reason : command.operation;
}

/**
 * Сохранённый результат применённой команды. Нечитаемая запись — внутреннее несоответствие,
 * а не разрешение повторить внешний эффект.
 */
function storedResult(operationRef: string, stored: unknown): OwnerResult {
  const parsed = ownerSuccessSchema.safeParse(stored);
  return parsed.success ? { ok: true, operationRef, result: parsed.data } : ownerFailure("dependency_unavailable");
}

/** Аудит собирается по объекту операции: решение и исполнение возврата ведут к своему платежу. */
function targetOf(command: OwnerOperation, outcome: OwnerOutcome): string {
  switch (command.operation) {
    case "offers.save": case "paymentOptions.save": case "promotions.save": return command.value.id;
    case "offers.archive": case "paymentOptions.archive": case "promotions.archive": return command.id;
    case "payments.list": return command.accountId ?? command.operationId;
    case "payments.read": case "payments.reconcile": case "refunds.decide": case "refunds.read": return command.purchaseRef;
    // Исполнение возврата ведёт к платежу своего решения.
    case "refunds.execute": return outcome.outcome === "refundDecision" ? outcome.value.purchaseRef : command.decisionRef;
    case "subscriptions.cancel": case "grants.read": return command.accountId;
    case "grants.previewBatch": return command.operationId;
    case "grants.applyBatch": return command.previewRef;
    case "grants.extend": case "grants.revoke": return command.grantRef;
    default: { const exhaustive: never = command; throw new Error(`Unknown billing operation ${JSON.stringify(exhaustive)}`); }
  }
}
