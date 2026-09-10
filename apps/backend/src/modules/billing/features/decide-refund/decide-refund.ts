import { randomUUID } from "node:crypto";
import type { BillingPrisma, BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { ownerFailure, type OwnerOperation, type OwnerResult } from "../../domain/owner-operations.js";
import { lockPurchase } from "../../infrastructure/postgres/catalog-lock.js";
import { refundTotals } from "../../shared/refund-amounts.js";
import { refundDecisionViews } from "../read-payments/read-payments.js";

type DecideRefundCommand = Extract<OwnerOperation, { operation: "refunds.decide" }>;

/**
 * Решение о возврате: сумма, судьба доступа и судьба автопродления записываются раздельно от
 * банковского исполнения. Даже полный возврат не отзывает доступ сам: отзыв — отдельное решение.
 * Решение принадлежит своей команде: повтор того же `operationId` возвращает исходное решение,
 * а не создаёт второе, потому что запись и её идентичность фиксируются одной транзакцией.
 */
export async function decideRefund(prisma: BillingPrismaClient, actorId: string, command: DecideRefundCommand,
  now: Date): Promise<OwnerResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<OwnerResult> => {
      await lockPurchase(tx, command.purchaseRef);
      const previous = await tx.billingRefundDecision.findUnique({
        where: { actorId_operationId: { actorId, operationId: command.operationId } } });
      // Решение того же operationId по другому платежу — другая команда, а не повтор этой.
      if (previous !== null) return previous.purchaseRef === command.purchaseRef
        ? await readDecision(tx, previous.purchaseRef, previous.id, command) : ownerFailure("operation_conflict");
      const purchase = await tx.billingPurchase.findUnique({ where: { id: command.purchaseRef } });
      if (purchase === null) return ownerFailure("not_found");
      // Возврат существует только по подтверждённому платежу с известной банковской операцией.
      if (purchase.state !== "confirmed" || purchase.paymentId === null) return ownerFailure("state_conflict");
      const totals = await refundTotals(tx, purchase.id, purchase.amountKopecks);
      if (command.amountKopecks > totals.refundableKopecks) return ownerFailure("unsupported_amount");
      const decisionRef = randomUUID();
      await tx.billingRefundDecision.create({ data: {
        id: decisionRef, purchaseRef: purchase.id, accountId: purchase.accountId, actorId,
        operationId: command.operationId, amountKopecks: BigInt(command.amountKopecks), access: command.access,
        recurring: command.recurring, reason: command.reason, state: "decided", revision: 1, createdAt: now, updatedAt: now,
      } });
      return await readDecision(tx, purchase.id, decisionRef, command);
    });
  } catch (error) {
    // Гонка двух решений с одним operationId: побеждает первое, второе читает его результат.
    const previous = await prisma.billingRefundDecision.findUnique({
      where: { actorId_operationId: { actorId, operationId: command.operationId } } });
    if (previous === null) throw error;
    return previous.purchaseRef === command.purchaseRef
      ? await readDecision(prisma, previous.purchaseRef, previous.id, command) : ownerFailure("operation_conflict");
  }
}

async function readDecision(tx: BillingPrisma, purchaseRef: string, decisionRef: string,
  command: DecideRefundCommand): Promise<OwnerResult> {
  const decisions = await refundDecisionViews(tx, purchaseRef);
  const value = decisions.find(decision => decision.decisionRef === decisionRef);
  if (value === undefined) throw new Error("Saved refund decision is missing");
  // Изменённая нагрузка того же operationId не переписывает принятое решение.
  if (value.amountKopecks !== command.amountKopecks || value.access !== command.access
    || value.recurring !== command.recurring || value.reason !== command.reason) return ownerFailure("operation_conflict");
  return { ok: true, operationRef: command.operationId, result: { outcome: "refundDecision", value } };
}
