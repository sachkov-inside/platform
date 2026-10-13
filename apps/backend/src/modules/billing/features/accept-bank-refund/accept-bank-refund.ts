import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  lockBillingSubscription,
  type BillingPrisma,
} from "../../../../infrastructure/prisma/index.js";
import { paidPeriodCommandSchema } from "../../../account-rights/index.js";
import { lifecycleWindow, refundSourceRef } from "../../domain/notice.js";
import { priceSnapshotSchema } from "../../domain/pricing.js";
import { recordBillingNotice } from "../../shared/record-notice.js";
import { advanceSubscription } from "../../shared/subscription-outcome.js";
import { unsettledRefundStates } from "../../shared/refund-amounts.js";

type Purchase = Awaited<
  ReturnType<BillingPrisma["billingPurchase"]["findUniqueOrThrow"]>
>;

/** Полный возврат уже подтверждён банком. Вызывается под замком покупки после проверки уведомления. */
export async function acceptBankRefund(
  tx: BillingPrisma,
  purchase: Purchase,
  now: Date,
): Promise<void> {
  const kind = "full_refund_confirmed";
  if (
    await tx.billingPaymentEvent.findUnique({
      where: { purchaseRef_kind: { purchaseRef: purchase.id, kind } },
    })
  )
    return;
  const refunds = await tx.billingRefund.findMany({
    where: { purchaseRef: purchase.id },
  });
  let recorded = refunds
    .filter((row) => row.state === "confirmed")
    .reduce((sum, row) => sum + row.amountKopecks, 0n);
  // Полный банковский результат доказывает и ранее отправленные попытки. Их суммы и история неизменны.
  for (const refund of refunds.filter((row) =>
    unsettledRefundStates.includes(row.state),
  )) {
    recorded += refund.amountKopecks;
    if (recorded > purchase.amountKopecks)
      throw new Error("Refund history exceeds purchase amount");
    await tx.billingRefund.update({
      where: { id: refund.id },
      data: {
        state: "confirmed",
        observedStatus: "REFUNDED",
        errorCode: "0",
        updatedAt: now,
      },
    });
    await tx.billingRefundDecision.update({
      where: { id: refund.decisionRef },
      data: { state: "executed", revision: { increment: 1 }, updatedAt: now },
    });
    await recordRefundNotice(
      tx,
      purchase,
      refund.id,
      refund.amountKopecks,
      now,
    );
  }
  const remaining = purchase.amountKopecks - recorded;
  if (remaining < 0n) throw new Error("Refund history exceeds purchase amount");
  const changesAccess =
    remaining > 0n ||
    refunds.some((row) => unsettledRefundStates.includes(row.state));
  const renewalCanceled = changesAccess
    ? await cancelRenewal(tx, purchase.id, now)
    : false;
  const decisionRef = randomUUID(),
    refundRef = randomUUID();
  if (remaining > 0n) {
    await tx.billingRefundDecision.create({
      data: {
        id: decisionRef,
        purchaseRef: purchase.id,
        accountId: purchase.accountId,
        actorId: null,
        operationId: null,
        amountKopecks: remaining,
        basis: "withdrawal",
        access: "revoke",
        recurring: renewalCanceled ? "cancel" : "keep",
        reason: "Full refund confirmed by T-Bank; initiated outside Platform",
        state: "executed",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    await tx.billingRefund.create({
      data: {
        id: refundRef,
        decisionRef,
        purchaseRef: purchase.id,
        environment: purchase.environment,
        terminalRef: purchase.terminalRef,
        paymentId: z.string().parse(purchase.paymentId),
        amountKopecks: remaining,
        state: "confirmed",
        observedStatus: "REFUNDED",
        errorCode: "0",
        createdAt: now,
        updatedAt: now,
      },
    });
    await recordRefundNotice(tx, purchase, refundRef, remaining, now);
  }
  // Исторически выполненный Platform-возврат сохраняет принятые тогда последствия.
  if (changesAccess) await revokePaidAccess(tx, purchase.id, decisionRef);
  await tx.billingPaymentEvent.create({
    data: {
      id: randomUUID(),
      purchaseRef: purchase.id,
      kind,
      payload: {
        paymentId: purchase.paymentId,
        amountKopecks: Number(purchase.amountKopecks),
      },
      occurredAt: now,
      recordedAt: now,
    },
  });
}

async function recordRefundNotice(
  tx: BillingPrisma,
  purchase: Purchase,
  refundRef: string,
  amountKopecks: bigint,
  now: Date,
): Promise<void> {
  await recordBillingNotice(
    tx,
    {
      kind: "refund_resolved",
      accountId: purchase.accountId,
      sourceRef: refundSourceRef(refundRef),
      attemptRef: purchase.id,
      title: priceSnapshotSchema.parse(purchase.snapshot).offer.name,
      amountKopecks: Number(amountKopecks),
      ...lifecycleWindow(now),
    },
    now,
  );
}

/** Отмена дальнейших списаний как следствие возврата: оплаченный срок при этом не сокращается. */
async function cancelRenewal(
  tx: BillingPrisma,
  purchaseRef: string,
  now: Date,
): Promise<boolean> {
  const purchase = await tx.billingPurchase.findUniqueOrThrow({
    where: { id: purchaseRef },
  });
  if (purchase.subscriptionRef === null) return false;
  await lockBillingSubscription(tx, purchase.subscriptionRef);
  const subscription = await tx.billingSubscription.findUniqueOrThrow({
    where: { id: purchase.subscriptionRef },
  });
  if (
    subscription.state !== "active" ||
    purchase.periodIndex !== subscription.periodIndex
  )
    return false;
  await advanceSubscription(
    tx,
    subscription,
    { state: "canceled", pendingChange: {} },
    "renewal_canceled",
    {
      paidUntil: subscription.paidUntil.toISOString(),
      refundedPurchaseRef: purchaseRef,
    },
    now,
  );
  return true;
}

/**
 * Отзыв оплаченных прав этой покупки. Повторяются ровно те условия, которые выдал платёж, с
 * новой revision: независимые manual, lifetime и legacy основания остаются нетронутыми.
 * Восстановление применяет outbox в порядке `nextAttemptAt`, поэтому выдача периода уходит
 * раньше своего отзыва, а сбой между ними восстанавливается без обращения в банк.
 */
async function revokePaidAccess(
  tx: BillingPrisma,
  purchaseRef: string,
  decisionRef: string,
): Promise<void> {
  const rows = await tx.billingFulfillment.findMany({ where: { purchaseRef } });
  const commands = rows.flatMap((row) => {
    const parsed = paidPeriodCommandSchema.safeParse(row.payload);
    return parsed.success ? [parsed.data] : [];
  });
  const latest = new Map<string, z.infer<typeof paidPeriodCommandSchema>>();
  for (const command of commands) {
    const previous = latest.get(command.periodRef);
    if (previous === undefined || command.revision > previous.revision)
      latest.set(command.periodRef, command);
  }
  for (const command of latest.values()) {
    if (command.revoked) continue;
    const eventRef = randomUUID();
    await tx.billingFulfillment.create({
      data: {
        eventRef,
        purchaseRef,
        payload: {
          ...command,
          eventRef,
          revision: command.revision + 1,
          revoked: true,
          terms: { ...command.terms, reason: `Refund decision ${decisionRef}` },
        },
      },
    });
  }
}
