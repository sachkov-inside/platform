import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BillingPrisma, BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { paidPeriodCommandSchema } from "../../../membership-entitlements/index.js";
import { ownerFailure, type OwnerOperation, type OwnerResult } from "../../domain/owner-operations.js";
import { priceSnapshotSchema } from "../../domain/pricing.js";
import { lockPurchase, lockSubscription } from "../../infrastructure/postgres/catalog-lock.js";
import { refundTerminalStatuses, type BankRefund, type Tbank } from "../../infrastructure/tbank/tbank.js";
import { advanceSubscription } from "../../shared/subscription-outcome.js";
import { refundTotals, unsettledRefundStates } from "../../shared/refund-amounts.js";
import { refundDecisionViews } from "../read-payments/read-payments.js";

type ExecuteRefundCommand = Extract<OwnerOperation, { operation: "refunds.execute" }>;
type RefundState = "sent" | "unknown" | "confirmed" | "failed";
interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly bank: Tbank | undefined;
  readonly clock: () => Date;
}
const contactSchema = z.object({ emailCiphertext: z.string() });

/**
 * Исполнение принятого решения о возврате. Попытка сохраняется до обращения к банку, её
 * `ExternalRequestId` закрепляет один запрос: потерянный ответ сверяется той же попыткой и не
 * создаёт второй возврат. Доступ и автопродление меняются только после подтверждённого возврата.
 */
export async function executeRefund(dependencies: Dependencies, actorId: string, command: ExecuteRefundCommand): Promise<OwnerResult> {
  const { prisma, bank } = dependencies;
  if (!bank) return ownerFailure("method_unavailable");
  const decision = await prisma.billingRefundDecision.findUnique({ where: { id: command.decisionRef } });
  if (decision === null) return ownerFailure("not_found");
  const prepared = await prisma.$transaction(async (tx): Promise<Extract<OwnerResult, { ok: false }> | { readonly ok: true; readonly refundRef: string }> => {
    const now = dependencies.clock();
    await lockPurchase(tx, decision.purchaseRef);
    const current = await tx.billingRefundDecision.findUniqueOrThrow({ where: { id: decision.id } });
    if (current.revision !== command.expectedRevision) return ownerFailure("revision_conflict");
    if (current.state === "executing") return ownerFailure("refund_in_progress");
    if (current.state !== "decided") return ownerFailure("state_conflict");
    const purchase = await tx.billingPurchase.findUniqueOrThrow({ where: { id: current.purchaseRef } });
    if (purchase.paymentId === null || purchase.state !== "confirmed") return ownerFailure("state_conflict");
    // Возврат исполняется только тем терминалом и окружением, которые приняли платёж.
    if (purchase.environment !== bank.config.environment || purchase.terminalRef !== bank.config.terminalKey)
      return ownerFailure("method_unavailable");
    // Одна незавершённая попытка на платёж: чужая отправка видна как незавершённый возврат.
    if (await tx.billingRefund.count({ where: { purchaseRef: purchase.id, state: { in: unsettledRefundStates } } }))
      return ownerFailure("refund_in_progress");
    const totals = await refundTotals(tx, purchase.id, purchase.amountKopecks);
    if (Number(current.amountKopecks) > totals.refundableKopecks) return ownerFailure("unsupported_amount");
    const refundRef = randomUUID();
    await tx.billingRefund.create({ data: {
      id: refundRef, decisionRef: current.id, purchaseRef: purchase.id,
      environment: purchase.environment, terminalRef: purchase.terminalRef, paymentId: purchase.paymentId,
      amountKopecks: current.amountKopecks, state: "sent", createdAt: now, updatedAt: now,
    } });
    await tx.billingRefundDecision.update({ where: { id: current.id },
      data: { state: "executing", revision: current.revision + 1, updatedAt: now } });
    return { ok: true, refundRef };
  });
  if (!("refundRef" in prepared)) return prepared;
  await sendRefund(dependencies, prepared.refundRef);
  return readDecision(prisma, decision.purchaseRef, decision.id, command.operationId);
}

/**
 * Сверка незавершённых возвратов. Повтор с прежним `ExternalRequestId` банк считает тем же
 * запросом, поэтому сверка не создаёт новый возврат и не увеличивает сумму.
 */
export async function reconcileRefunds(dependencies: Dependencies, limit = 20): Promise<{ readonly inspected: number; readonly settled: number }> {
  const { prisma, bank } = dependencies;
  if (!bank) return { inspected: 0, settled: 0 };
  // Падение процесса между сохранением попытки и ответом банка оставляет её `sent`: она тоже сверяется.
  const rows = await prisma.billingRefund.findMany({
    where: { state: { in: unsettledRefundStates }, environment: bank.config.environment, terminalRef: bank.config.terminalKey },
    orderBy: { createdAt: "asc" }, take: limit,
  });
  let settled = 0;
  for (const row of rows) if (await sendRefund(dependencies, row.id)) settled += 1;
  return { inspected: rows.length, settled };
}

/** Одна отправка одной сохранённой попытки; результат применяется отдельной транзакцией. */
async function sendRefund(dependencies: Dependencies, refundRef: string): Promise<boolean> {
  const { prisma, bank } = dependencies;
  if (!bank) return false;
  const row = await prisma.billingRefund.findUnique({ where: { id: refundRef }, include: { decision: true } });
  if (!row || !unsettledRefundStates.includes(row.state)) return false;
  const purchase = await prisma.billingPurchase.findUniqueOrThrow({ where: { id: row.purchaseRef } });
  let observed: BankRefund | undefined;
  try {
    const snapshot = priceSnapshotSchema.parse(purchase.snapshot);
    const contact = contactSchema.parse(purchase.contact);
    observed = await bank.cancel({
      paymentId: row.paymentId, amount: Number(row.amountKopecks), externalRequestId: row.id,
      name: snapshot.offer.name, email: z.email().parse(bank.openBinding(`${purchase.id}:contact`, contact.emailCiphertext)),
    });
  } catch {
    // Ответ потерян: попытка остаётся неизвестной и сверяется тем же ExternalRequestId.
    await prisma.billingRefund.updateMany({ where: { id: row.id, state: { in: unsettledRefundStates } },
      data: { state: "unknown", observedStatus: "no_response", updatedAt: dependencies.clock() } });
    return false;
  }
  // Только доказанный терминальный статус завершает возврат; успешный промежуточный ждёт сверки.
  const succeeded = observed.Success && observed.ErrorCode === "0";
  const state: RefundState = !succeeded ? "failed"
    : refundTerminalStatuses.some(status => status === observed.Status) ? "confirmed" : "unknown";
  await prisma.$transaction(async tx => {
    const now = dependencies.clock();
    await lockPurchase(tx, row.purchaseRef);
    const attempt = await tx.billingRefund.findUniqueOrThrow({ where: { id: row.id } });
    if (attempt.state === "confirmed" || attempt.state === "failed") return;
    await tx.billingRefund.update({ where: { id: row.id },
      data: { state, observedStatus: observed.Status, errorCode: observed.ErrorCode, updatedAt: now } });
    if (state === "unknown") return;
    const decision = await tx.billingRefundDecision.findUniqueOrThrow({ where: { id: attempt.decisionRef } });
    if (state === "failed") {
      await tx.billingRefundDecision.update({ where: { id: decision.id },
        data: { state: "failed", revision: decision.revision + 1, updatedAt: now } });
      return;
    }
    if (decision.recurring === "cancel") await cancelRenewal(tx, row.purchaseRef, now);
    if (decision.access === "revoke") await revokePaidAccess(tx, row.purchaseRef, decision.id);
    await tx.billingRefundDecision.update({ where: { id: decision.id },
      data: { state: "executed", revision: decision.revision + 1, updatedAt: now } });
  });
  return state === "confirmed" || state === "failed";
}

/** Отмена дальнейших списаний как следствие возврата: оплаченный срок при этом не сокращается. */
async function cancelRenewal(tx: BillingPrisma, purchaseRef: string, now: Date): Promise<void> {
  const purchase = await tx.billingPurchase.findUniqueOrThrow({ where: { id: purchaseRef } });
  if (purchase.subscriptionRef === null) return;
  await lockSubscription(tx, purchase.subscriptionRef);
  const subscription = await tx.billingSubscription.findUniqueOrThrow({ where: { id: purchase.subscriptionRef } });
  if (subscription.state !== "active") return;
  await advanceSubscription(tx, subscription, { state: "canceled", pendingChange: {} }, "renewal_canceled",
    { paidUntil: subscription.paidUntil.toISOString(), refundedPurchaseRef: purchaseRef }, now);
}

/**
 * Отзыв оплаченных прав этой покупки. Повторяются ровно те условия, которые выдал платёж, с
 * новой revision: независимые manual, lifetime и legacy основания остаются нетронутыми.
 * Восстановление применяет outbox в порядке `nextAttemptAt`, поэтому выдача периода уходит
 * раньше своего отзыва, а сбой между ними восстанавливается без обращения в банк.
 */
async function revokePaidAccess(tx: BillingPrisma, purchaseRef: string, decisionRef: string): Promise<void> {
  const rows = await tx.billingFulfillment.findMany({ where: { purchaseRef } });
  const commands = rows.flatMap(row => {
    const parsed = paidPeriodCommandSchema.safeParse(row.payload);
    return parsed.success ? [parsed.data] : [];
  });
  const latest = new Map<string, z.infer<typeof paidPeriodCommandSchema>>();
  for (const command of commands) {
    const previous = latest.get(command.periodRef);
    if (previous === undefined || command.revision > previous.revision) latest.set(command.periodRef, command);
  }
  for (const command of latest.values()) {
    if (command.revoked) continue;
    const eventRef = randomUUID();
    await tx.billingFulfillment.create({ data: { eventRef, purchaseRef, payload: {
      ...command, eventRef, revision: command.revision + 1, revoked: true,
      terms: { ...command.terms, reason: `Refund decision ${decisionRef}` },
    } } });
  }
}

async function readDecision(prisma: BillingPrismaClient, purchaseRef: string, decisionRef: string,
  operationId: string): Promise<OwnerResult> {
  const decisions = await refundDecisionViews(prisma, purchaseRef);
  const value = decisions.find(decision => decision.decisionRef === decisionRef);
  if (value === undefined) return ownerFailure("not_found");
  return { ok: true, operationRef: operationId, result: { outcome: "refundDecision", value } };
}
