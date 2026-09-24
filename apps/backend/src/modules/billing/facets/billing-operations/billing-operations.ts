import type { TributeConvergence } from "../tribute-convergence/tribute-convergence.js";
import { z } from "zod";
import { benefitPeriodsSchema } from "../../domain/pricing.js";
import { lockPricing } from "../../infrastructure/postgres/catalog-lock.js";
import { courseSourceRef, tierSnapshotSchema } from "../../../membership-entitlements/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { Accounts } from "../../../accounts/index.js";
import { recurringAllowedFor, type AccessGrants } from "../../../membership-entitlements/index.js";
import {
  isOwnerReadOperation, ownerAccessFailure, ownerFailure, ownerOperationSchema, ownerPaymentFailure,
  ownerSuccessSchema, type OwnerOperation, type OwnerOutcome, type OwnerResult,
} from "../../domain/owner-operations.js";
import { decideRefund } from "../../features/decide-refund/decide-refund.js";
import { executeRefund, reconcileRefunds } from "../../features/execute-refund/execute-refund.js";
import { listPayments, paymentView, readPayment, refundDecisionViews } from "../../features/read-payments/read-payments.js";
import { commandFingerprint } from "../../shared/command-fingerprint.js";
import { refundTotals } from "../../shared/refund-amounts.js";
import { offerGrantsWithheld, tierLacksComposition } from "../../shared/tier-composition.js";
import type { Tbank } from "../../infrastructure/tbank/tbank.js";
import type { BillingPayments } from "../billing-payments/billing-payments.js";
import type { BillingPricing } from "../billing-pricing/billing-pricing.js";
import type { BillingSubscriptions } from "../billing-subscriptions/billing-subscriptions.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";

interface Dependencies {
  readonly tribute?: TributeConvergence;
  readonly prisma: BillingPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly pricing: Pick<BillingPricing, "manage" | "ownerCatalog">;
  readonly payments: Pick<BillingPayments, "reconcile">;
  readonly subscriptions: Pick<BillingSubscriptions, "cancel">;
  readonly grants: Pick<AccessGrants, "lookupRecipient" | "readContentCatalog" | "previewBatch" | "applyBatch" | "changeGrant" | "listGrants"
    | "classifyLegacy" | "readClassification" | "registerSourceEntitlement" | "manageActivationRule" | "listActivationRules" | "previewEnrollmentExpansion" | "applyEnrollmentExpansion" | "readEnrollmentAssignmentReceipt" | "assignEnrollment" | "changeEnrollment" | "listEnrollments">;
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
    } catch (error) { return dependencyFailure({ module: "billing", operation: "execute" }, error, ownerFailure("dependency_unavailable")); }
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
      case "tribute.status": {
        if (this.dependencies.tribute === undefined) return ownerFailure("dependency_unavailable");
        const result = await this.dependencies.tribute.status(actorId, command.page ?? 0);
        return result.ok ? { ok: true, operationRef, result: { outcome: "tributeStatus", value: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "tribute.dismissImport": {
        if (this.dependencies.tribute === undefined) return ownerFailure("dependency_unavailable");
        const { operation: _operation, ...input } = command;
        const result = await this.dependencies.tribute.dismissImport(actorId, input);
        return result.ok ? { ok: true, operationRef, result: { outcome: "tributeImportReview", value: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "tribute.savePolicy": {
        if (this.dependencies.tribute === undefined) return ownerFailure("dependency_unavailable");
        const { operation: _operation, ...input } = command;
        const result = await this.dependencies.tribute.savePolicy(actorId, input);
        return result.ok ? { ok: true, operationRef, result: { outcome: "tributePolicy", value: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "tribute.preview": {
        if (this.dependencies.tribute === undefined) return ownerFailure("dependency_unavailable");
        const { operation: _operation, ...input } = command;
        const result = await this.dependencies.tribute.preview(actorId, input);
        return result.ok ? { ok: true, operationRef, result: { outcome: "tributePreview", value: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "tribute.apply": {
        if (this.dependencies.tribute === undefined) return ownerFailure("dependency_unavailable");
        const { operation: _operation, ...input } = command;
        const result = await this.dependencies.tribute.apply(actorId, input);
        return result.ok ? { ok: true, operationRef, result: { outcome: "tributeApplied", value: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "tribute.reconcile": {
        if (this.dependencies.tribute === undefined) return ownerFailure("dependency_unavailable");
        const { operation: _operation, ...input } = command;
        const result = await this.dependencies.tribute.reconcile(actorId, input);
        return result.ok ? { ok: true, operationRef, result: { outcome: "tributeSource", value: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "tribute.retryEvent": {
        if (this.dependencies.tribute === undefined) return ownerFailure("dependency_unavailable");
        const { operation: _operation, ...input } = command;
        const result = await this.dependencies.tribute.retryEvent(actorId, input);
        return result.ok ? { ok: true, operationRef, result: { outcome: "tributeEvent", value: result.value } } : ownerAccessFailure(result.error.code);
      }

      case "recipients.lookup": {
        const result = await grants.lookupRecipient(actorId, command.identityRef);
        if (!result.ok) return ownerAccessFailure(result.error.code);
        const { ok: _ok, ...value } = result;
        return { ok: true, operationRef, result: { outcome: "recipient", value } };
      }
      case "content.list": {
        const result = await grants.readContentCatalog(actorId);
        return result.ok ? { ok: true, operationRef, result: { outcome: "content", items: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "sources.register": {
        const { operation: _operation, ...input } = command;
        const result = await grants.registerSourceEntitlement(actorId, input);
        return result.ok ? { ok: true, operationRef, result: { outcome: "sourceEntitlement", value: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "activationRules.list": {
        const result = await grants.listActivationRules(actorId);
        return result.ok ? { ok: true, operationRef, result: { outcome: "activationRules", items: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "activationRules.save": {
        return prisma.$transaction(async tx => {
          await lockPricing(tx);
          const row = await tx.billingOffer.findUnique({ where: { id: command.value.tierId } });
          if (command.value.published && (row === null || row.archived || !row.availableForAssignment)) return ownerFailure("not_found");
          if (command.value.published && row !== null && (tierLacksComposition(row) || offerGrantsWithheld(row))) return ownerFailure("state_conflict");
          if (command.value.published && row?.revision !== command.value.tierRevision) return ownerFailure("revision_conflict");
          const { operation: _operation, ...input } = command;
          const result = await grants.manageActivationRule(actorId, input);
          return result.ok ? { ok: true, operationRef, result: { outcome: "activationRule", value: result.value } } : ownerAccessFailure(result.error.code);
        });
      }
      case "enrollments.previewExpansion": {
        return prisma.$transaction(async tx => {
          await lockPricing(tx);
          const row = await tx.billingOffer.findUnique({ where: { id: command.tierId } });
          if (row === null) return ownerFailure("not_found");
          if (row.revision !== command.tierRevision) return ownerFailure("revision_conflict");
          if (offerGrantsWithheld(row)) return ownerFailure("state_conflict");
          const { operation: _operation, ...input } = command;
          const result = await grants.previewEnrollmentExpansion(actorId, input, { id: row.id, revision: row.revision, name: row.name, benefits: row.benefits, contentScope: row.contentScope });
          return result.ok ? { ok: true, operationRef, result: { outcome: "enrollmentExpansionPreview", value: result.value } } : ownerAccessFailure(result.error.code);
        });
      }
      case "enrollments.applyExpansion": {
        const { operation: _operation, ...input } = command;
        const result = await grants.applyEnrollmentExpansion(actorId, input);
        return result.ok ? { ok: true, operationRef, result: { outcome: "enrollmentExpansion", enrollmentIds: result.enrollmentIds } } : ownerAccessFailure(result.error.code);
      }
      case "tiers.list": {
        const rows = await prisma.billingOffer.findMany({ where: {
          ...(command.cursor === undefined ? {} : { id: { gt: command.cursor } }),
        }, orderBy: { id: "asc" }, take: command.limit + 1 });
        const items = rows.slice(0, command.limit).flatMap(row => {
          const tier = tierSnapshotSchema.safeParse({ id: row.id, revision: row.revision, name: row.name,
            benefits: row.benefits, contentScope: row.contentScope });
          return tier.success ? [{ tier: tier.data, benefitPeriods: benefitPeriodsSchema.parse(row.benefitPeriods), availableForAssignment: row.availableForAssignment,
            published: row.published, archived: row.archived }] : [];
        });
        return { ok: true, operationRef, result: { outcome: "tiers", items,
          nextCursor: rows.length > command.limit ? rows[command.limit - 1]?.id ?? null : null } };
      }
      case "enrollments.assign": {
        if (command.origin === "platform_payment") return ownerFailure("forbidden");
        const { operation: _operation, ...requested } = command;
        if (command.origin === "course" && command.courseSource === undefined) return ownerFailure("invalid_request");
        const input = command.origin === "course" && command.courseSource !== undefined
          ? { ...requested, sourceRef: courseSourceRef(command.courseSource.policyRef, command.courseSource.verifiedIdentityRef) } : requested;
        const receipt = await grants.readEnrollmentAssignmentReceipt(actorId, input);
        if (receipt !== null) return receipt.ok
          ? { ok: true, operationRef, result: { outcome: "enrollment", value: receipt.value } }
          : ownerFailure(receipt.error.code === "identity_conflict" ? "identity_changed" : receipt.error.code === "invalid_input" ? "invalid_request" : receipt.error.code === "unavailable" ? "dependency_unavailable" : receipt.error.code);
        return prisma.$transaction(async tx => {
          await lockPricing(tx);
          const row = await tx.billingOffer.findUnique({ where: { id: command.tierId } });
          if (row === null || row.archived || !row.availableForAssignment) return ownerFailure("not_found");
          if (row.revision !== command.tierRevision) return ownerFailure("revision_conflict");
          // Тариф без состава дал бы чат без материалов, а отдельный материал и `reviews` не выдаются.
          if (tierLacksComposition(row) || offerGrantsWithheld(row)) return ownerFailure("state_conflict");
          const tier = tierSnapshotSchema.safeParse({ id: row.id, revision: row.revision, name: row.name,
            benefits: row.benefits, contentScope: row.contentScope });
          if (!tier.success) return ownerFailure("invalid_request");
          const result = await grants.assignEnrollment(actorId, input, tier.data);
          return result.ok ? { ok: true, operationRef, result: { outcome: "enrollment", value: result.value } }
            : ownerFailure(result.error.code === "identity_conflict" ? "identity_changed" : result.error.code === "invalid_input" ? "invalid_request" : result.error.code === "unavailable" ? "dependency_unavailable" : result.error.code);
        });
      }
      case "enrollments.change": {
        const { operation: _operation, ...input } = command;
        const result = await grants.changeEnrollment(actorId, input);
        return result.ok ? { ok: true, operationRef, result: { outcome: "enrollment", value: result.value } }
          : ownerFailure(result.error.code === "identity_conflict" ? "identity_changed" : result.error.code === "invalid_input" ? "invalid_request" : result.error.code === "unavailable" ? "dependency_unavailable" : result.error.code);
      }
      case "enrollments.list": {
        const result = await grants.listEnrollments(actorId, command.accountId);
        return result.ok ? { ok: true, operationRef, result: { outcome: "enrollments", items: result.value } } : ownerAccessFailure(result.error.code);
      }
      case "offers.save": case "offers.archive": case "offers.publish": case "offers.unpublish":
      case "paymentOptions.save": case "paymentOptions.archive":
      case "promotions.save": case "promotions.archive": {
        const result = await this.dependencies.pricing.manage(actorId, command);
        return result.ok
          ? { ok: true, operationRef, result: { outcome: "catalog", value: result.value } } : ownerFailure(result.error.code);
      }
      case "offers.list": {
        const result = await this.dependencies.pricing.ownerCatalog({ cursor: command.cursor, limit: command.limit });
        return result.ok
          ? { ok: true, operationRef, result: { outcome: "catalogOffers", items: [...result.value.items], nextCursor: result.value.nextCursor } }
          : ownerFailure(result.error.code);
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
      case "grants.readClassification": {
        const result = await grants.readClassification(actorId, command.accountId);
        return result.ok
          ? classificationOutcome(operationRef, command.accountId, result)
          : ownerAccessFailure(result.error.code);
      }
      case "grants.classify": {
        // Ответ собирается из применённой команды: повтор проходит только при совпадении
        // fingerprint, поэтому команда и есть записанное решение.
        const { operation: _operation, ...rest } = command;
        const result = await grants.classifyLegacy(actorId, rest);
        return result.ok
          ? classificationOutcome(operationRef, command.accountId,
            { classification: command.classification, revision: result.revision, recurringAllowed: recurringAllowedFor(command) })
          : ownerAccessFailure(result.error.code);
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
 * Состояние покупателя одной формой: чтение и записанное решение отвечают одинаково. Поля
 * перечислены поимённо: источник может нести служебные поля, а в ответ уходит ровно вид.
 */
function classificationOutcome(operationRef: string, accountId: string,
  state: { readonly classification: "confirmed_legacy" | "confirmed_new" | "unknown";
    readonly revision: number; readonly recurringAllowed: boolean }): OwnerResult {
  return { ok: true, operationRef, result: { outcome: "classification", value: { accountId,
    classification: state.classification, revision: state.revision, recurringAllowed: state.recurringAllowed } } };
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
    case "tribute.dismissImport": case "tribute.status": case "tribute.savePolicy": case "tribute.preview": case "tribute.apply": case "tribute.reconcile": case "tribute.retryEvent": return command.operationId;
    case "offers.save": case "paymentOptions.save": case "promotions.save": return command.value.id;
    case "offers.archive": case "offers.publish": case "offers.unpublish": case "paymentOptions.archive": case "promotions.archive": return command.id;
    case "sources.register": return command.operationId;
    case "activationRules.save": return command.value.id;
    case "activationRules.list": return command.operationId;
    case "enrollments.previewExpansion": case "enrollments.applyExpansion": return command.operationId;
    case "recipients.lookup": case "content.list": case "tiers.list": case "offers.list": return command.operationId;
    case "enrollments.assign": case "enrollments.list": return command.accountId;
    case "enrollments.change": return command.enrollmentId;
    case "payments.list": return command.accountId ?? command.operationId;
    case "payments.read": case "payments.reconcile": case "refunds.decide": case "refunds.read": return command.purchaseRef;
    // Исполнение возврата ведёт к платежу своего решения.
    case "refunds.execute": return outcome.outcome === "refundDecision" ? outcome.value.purchaseRef : command.decisionRef;
    case "subscriptions.cancel": case "grants.read": case "grants.readClassification": case "grants.classify": return command.accountId;
    case "grants.previewBatch": return command.operationId;
    case "grants.applyBatch": return command.previewRef;
    case "grants.extend": case "grants.revoke": return command.grantRef;
    default: { const exhaustive: never = command; throw new Error(`Unknown billing operation ${JSON.stringify(exhaustive)}`); }
  }
}
