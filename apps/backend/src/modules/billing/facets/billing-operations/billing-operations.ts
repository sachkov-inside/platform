import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { type AccessGrants } from "../../../account-rights/index.js";
import type { Accounts } from "../../../accounts/index.js";
import {
  isOwnerReadOperation,
  ownerAccessFailure,
  ownerFailure,
  ownerOperationSchema,
  ownerPaymentFailure,
  ownerSuccessSchema,
  type OwnerOperation,
  type OwnerOutcome,
  type OwnerResult,
} from "../../domain/owner-operations.js";
import {
  listPayments,
  paymentView,
  readPayment,
  refundDecisionViews,
} from "../../features/read-payments/read-payments.js";
import { reconcileRefunds } from "../../features/reconcile-refunds/reconcile-refunds.js";
import {
  importRespondents,
  issueRespondentLink,
  readRespondents,
} from "../../features/survey-respondents/survey-respondents.js";
import type { Tbank } from "../../infrastructure/tbank/tbank.js";
import { commandFingerprint } from "../../shared/command-fingerprint.js";
import { refundTotals } from "../../shared/refund-amounts.js";
import type { BillingPayments } from "../billing-payments/billing-payments.js";
import type { BillingPricing } from "../billing-pricing/billing-pricing.js";

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly accounts: Pick<Accounts, "checkPermission">;
  readonly pricing: Pick<
    BillingPricing,
    "manage" | "ownerCatalog" | "managePaymentLink" | "paymentLinks"
  >;
  readonly payments: Pick<BillingPayments, "reconcile">;
  readonly grants: Pick<
    AccessGrants,
    | "lookupRecipient"
    | "readContentCatalog"
    | "manageActivationRule"
    | "listActivationRules"
  >;
  readonly bank: Tbank | undefined;
  /** База deep link бота `t.me/<бот>`; без неё приглашение отдаёт только start-параметр. */
  readonly botStartUrl?: string | undefined;
  readonly clock?: () => Date;
}
/**
 * Одна владельческая поверхность billing для admin API и MCP: каталог, платежи и сверка,
 * история возвратов, ручные права. Одинаковые полномочия, идемпотентность и
 * проверка revision в обоих транспортах; MCP не получает больше власти, чем admin endpoint.
 */
export class BillingOperations {
  private readonly clock: () => Date;
  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async execute(actorId: string, input: unknown): Promise<OwnerResult> {
    if (!z.uuid().safeParse(actorId).success) return ownerFailure("forbidden");
    const parsed = ownerOperationSchema.safeParse(input);
    if (!parsed.success) return ownerFailure("invalid_request");
    const command = parsed.data;
    try {
      const permission = await this.dependencies.accounts.checkPermission({
        accountId: actorId,
        permission: "billing:manage",
      });
      if (!permission.ok) return ownerFailure("dependency_unavailable");
      if (!permission.allowed) return ownerFailure("forbidden");
      if (isOwnerReadOperation(command.operation))
        return await this.dispatch(actorId, command);
      const digest = commandFingerprint(command.operation, command);
      // Ключ закрепляется до применения, включая команды других семейств и незавершённый аудит.
      await this.dependencies.prisma.billingOwnerCommandKey.createMany({
        data: {
          actorId,
          operationId: command.operationId,
          fingerprint: digest,
          createdAt: this.clock(),
        },
        skipDuplicates: true,
      });
      const key =
        await this.dependencies.prisma.billingOwnerCommandKey.findUniqueOrThrow(
          {
            where: {
              actorId_operationId: {
                actorId,
                operationId: command.operationId,
              },
            },
          },
        );
      if (key.fingerprint !== digest) return ownerFailure("operation_conflict");
      const receipt =
        await this.dependencies.prisma.billingOwnerCommand.findUnique({
          where: {
            actorId_operationId: { actorId, operationId: command.operationId },
          },
        });
      if (receipt !== null) {
        if (receipt.fingerprint !== digest)
          return ownerFailure("operation_conflict");
        return await this.replay(actorId, command, receipt.result);
      }
      if (key.result !== null) {
        const restored = await this.replay(actorId, command, key.result);
        if (!restored.ok) return restored;
        return await this.record(actorId, command, digest, restored);
      }
      const result = await this.dispatch(actorId, command);
      if (!result.ok) return result;
      await this.dependencies.prisma.billingOwnerCommandKey.updateMany({
        where: {
          actorId,
          operationId: command.operationId,
          result: { equals: Prisma.DbNull },
        },
        data: { result: auditedOutcome(result.result) },
      });
      const completed =
        await this.dependencies.prisma.billingOwnerCommandKey.findUniqueOrThrow(
          {
            where: {
              actorId_operationId: {
                actorId,
                operationId: command.operationId,
              },
            },
          },
        );
      const restored = await this.replay(actorId, command, completed.result);
      if (!restored.ok) return restored;
      return await this.record(actorId, command, digest, restored);
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "execute" },
        error,
        ownerFailure("dependency_unavailable"),
      );
    }
  }

  private async replay(
    _actorId: string,
    command: OwnerOperation,
    outcome: unknown,
  ): Promise<OwnerResult> {
    return storedResult(command.operationId, outcome);
  }

  /**
   * Audit применённой команды: он же receipt повтора. Гонка двух одинаковых operationId решается
   * первичным ключом: проигравший возвращает сохранённый результат победителя, а не ошибку.
   */
  private async record(
    actorId: string,
    command: OwnerOperation,
    digest: string,
    result: Extract<OwnerResult, { ok: true }>,
  ): Promise<OwnerResult> {
    const data = {
      actorId,
      operationId: command.operationId,
      operation: command.operation,
      fingerprint: digest,
      targetRef: targetOf(command, result.result),
      reason: reasonOf(command, result.result),
      result: auditedOutcome(result.result),
      createdAt: this.clock(),
    };
    try {
      await this.dependencies.prisma.billingOwnerCommand.create({ data });
      return result;
    } catch (error) {
      const receipt =
        await this.dependencies.prisma.billingOwnerCommand.findUnique({
          where: {
            actorId_operationId: { actorId, operationId: command.operationId },
          },
        });
      if (receipt === null) throw error;
      if (receipt.fingerprint !== digest)
        return ownerFailure("operation_conflict");
      return await this.replay(actorId, command, receipt.result);
    }
  }

  /** Сверка незавершённых возвратов принадлежит процессу восстановления, не владельческой команде. */
  reconcileRefunds(limit?: number) {
    return reconcileRefunds(
      {
        prisma: this.dependencies.prisma,
        bank: this.dependencies.bank,
        payments: this.dependencies.payments,
      },
      limit,
    );
  }

  private async dispatch(
    actorId: string,
    command: OwnerOperation,
  ): Promise<OwnerResult> {
    const { prisma, grants } = this.dependencies;
    const operationRef = command.operationId;
    switch (command.operation) {
      case "paymentLinks.create":
      case "paymentLinks.revoke": {
        const result = await this.dependencies.pricing.managePaymentLink(
          actorId,
          command,
        );
        return result.ok
          ? {
              ok: true,
              operationRef,
              result: { outcome: "paymentLink", value: result.value },
            }
          : ownerFailure(
              result.error.code === "quote_changed"
                ? "state_conflict"
                : result.error.code,
            );
      }
      case "paymentLinks.list": {
        const result = await this.dependencies.pricing.paymentLinks(actorId, {
          ...(command.cursor === undefined ? {} : { cursor: command.cursor }),
          limit: command.limit,
        });
        return result.ok
          ? {
              ok: true,
              operationRef,
              result: { outcome: "paymentLinks", ...result.value },
            }
          : ownerFailure(result.error.code);
      }
      case "recipients.lookup": {
        const result = await grants.lookupRecipient(
          actorId,
          command.identityRef,
        );
        if (!result.ok) return ownerAccessFailure(result.error.code);
        const { ok: _ok, ...value } = result;
        return {
          ok: true,
          operationRef,
          result: { outcome: "recipient", value },
        };
      }
      case "content.list": {
        const result = await grants.readContentCatalog(actorId);
        return result.ok
          ? {
              ok: true,
              operationRef,
              result: { outcome: "content", items: result.value },
            }
          : ownerAccessFailure(result.error.code);
      }
      case "activationRules.list": {
        const result = await grants.listActivationRules(actorId);
        return result.ok
          ? {
              ok: true,
              operationRef,
              result: { outcome: "activationRules", items: result.value },
            }
          : ownerAccessFailure(result.error.code);
      }
      case "activationRules.save": {
        const { operation: _operation, ...input } = command;
        const result = await grants.manageActivationRule(actorId, input);
        return result.ok
          ? {
              ok: true,
              operationRef,
              result: { outcome: "activationRule", value: result.value },
            }
          : ownerAccessFailure(result.error.code);
      }
      case "productPrices.save":
      case "productPrices.archive":
      case "promotions.save":
      case "promotions.archive":
      case "cohorts.save": {
        const result = await this.dependencies.pricing.manage(actorId, command);
        return result.ok
          ? {
              ok: true,
              operationRef,
              result: { outcome: "catalog", value: result.value },
            }
          : ownerFailure(result.error.code);
      }
      case "productPrices.list": {
        const result = await this.dependencies.pricing.ownerCatalog({
          cursor: command.cursor,
          limit: command.limit,
        });
        return result.ok
          ? {
              ok: true,
              operationRef,
              result: { outcome: "catalogOffers", ...result.value },
            }
          : ownerFailure(result.error.code);
      }
      case "payments.list":
        return await listPayments(prisma, command);
      case "payments.read": {
        const result = await readPayment(
          prisma,
          command.purchaseRef,
          command.auditCursor,
        );
        return "result" in result
          ? { ok: true, operationRef, result: result.result }
          : result;
      }
      case "payments.reconcile": {
        const row = await prisma.billingPurchase.findUnique({
          where: { id: command.purchaseRef },
          select: { id: true },
        });
        if (row === null) return ownerFailure("not_found");
        const reconciled = await this.dependencies.payments.reconcile(
          command.purchaseRef,
        );
        if (!reconciled.ok) return ownerPaymentFailure(reconciled.error.code);
        const current = await prisma.billingPurchase.findUniqueOrThrow({
          where: { id: command.purchaseRef },
        });
        return {
          ok: true,
          operationRef,
          result: {
            outcome: "reconciled",
            value: await paymentView(prisma, current),
          },
        };
      }
      case "refunds.read": {
        const purchase = await prisma.billingPurchase.findUnique({
          where: { id: command.purchaseRef },
        });
        if (purchase === null) return ownerFailure("not_found");
        const totals = await refundTotals(
          prisma,
          purchase.id,
          purchase.amountKopecks,
        );
        return {
          ok: true,
          operationRef,
          result: {
            outcome: "refunds",
            purchaseRef: purchase.id,
            refundedKopecks: totals.refundedKopecks,
            refundableKopecks: totals.refundableKopecks,
            decisions: await refundDecisionViews(prisma, purchase.id),
          },
        };
      }
      case "respondents.import": {
        const result = await importRespondents(prisma, command, this.clock());
        return result.ok
          ? {
              ok: true,
              operationRef,
              result: { outcome: "respondentImport", value: result.value },
            }
          : ownerFailure(result.error.code);
      }
      case "respondents.issue": {
        const result = await issueRespondentLink(
          { prisma, grants },
          actorId,
          command,
          this.clock(),
        );
        return result.ok
          ? {
              ok: true,
              operationRef,
              result: { outcome: "respondentLink", value: result.value },
            }
          : ownerFailure(result.error.code);
      }
      case "respondents.status":
        return {
          ok: true,
          operationRef,
          result: {
            outcome: "respondents",
            value: await readRespondents(prisma),
          },
        };
      default: {
        const exhaustive: never = command;
        throw new Error(
          `Unknown billing operation ${JSON.stringify(exhaustive)}`,
        );
      }
    }
  }
}

/**
 * Итог команды для журнала. Код и ссылка приглашения погашают его, поэтому журнал их не хранит;
 * остальные итоги записываются как есть.
 */
function auditedOutcome(outcome: OwnerOutcome): OwnerOutcome {
  return outcome;
}

function storedResult(operationRef: string, stored: unknown): OwnerResult {
  const parsed = ownerSuccessSchema.safeParse(stored);
  return parsed.success
    ? { ok: true, operationRef, result: parsed.data }
    : ownerFailure("dependency_unavailable");
}

/** Аудит собирается по объекту операции: решение и исполнение возврата ведут к своему платежу. */
function targetOf(command: OwnerOperation, _outcome: OwnerOutcome): string {
  if ("purchaseRef" in command) return command.purchaseRef;
  if ("productId" in command) return command.productId;
  if ("id" in command) return command.id;
  return command.operationId;
}

function reasonOf(command: OwnerOperation, _outcome: OwnerOutcome): string {
  return "reason" in command && typeof command.reason === "string"
    ? command.reason
    : command.operation;
}
