import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type BillingPrisma } from "../../../../infrastructure/prisma/index.js";
import { lifecycleWindow, refundSourceRef } from "../../domain/notice.js";
import type { RefundBasis } from "../../domain/owner-operations.js";
import { paymentEventKind } from "../../domain/payment-events.js";
import { priceSnapshotSchema } from "../../domain/pricing.js";
import type { BankStatus } from "../../infrastructure/tbank/bank-statuses.js";
import { recordBillingNotice } from "../../shared/record-notice.js";
import {
  refundTotals,
  unsettledRefundStates,
} from "../../shared/refund-amounts.js";

type Purchase = Awaited<
  ReturnType<BillingPrisma["billingPurchase"]["findUniqueOrThrow"]>
>;

/** Полный возврат уже подтверждён банком. Вызывается под замком покупки после проверки уведомления. */
export async function acceptBankRefund(
  tx: BillingPrisma,
  purchase: Purchase,
  now: Date,
): Promise<void> {
  await tx.billingPurchase.update({
    where: { id: purchase.id },
    data: { refundReviewRequired: false },
  });
  const kind = paymentEventKind.fullRefundConfirmed;
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
  if (remaining > 0n) {
    const refundRef = await recordBankConfirmedRefund(
      tx,
      purchase,
      {
        amountKopecks: remaining,
        basis: "withdrawal",
        reason: "Full refund confirmed by T-Bank; initiated outside Platform",
        paymentId: z.string().parse(purchase.paymentId),
        observedStatus: "REFUNDED",
      },
      now,
    );
    await recordRefundNotice(tx, purchase, refundRef, remaining, now);
  }
  // A bank refund is financial history. Only an explicit owner command may withdraw Product Access.
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

/**
 * Опоздавший Cancel снятой попытки вернул покупателю деньги (#1932). Возврат пишется обычной
 * строкой истории с основанием `automatic_cancel`: решение принял Inside, а не владелец. Cancel
 * без Amount возвращает полную сумму, поэтому строка несёт остаток покупки сверх уже записанных
 * возвратов. Если полный возврат уже записан, например уведомлением `REFUNDED`, строка не
 * создаётся. Доступа у снятой попытки нет, и строка его не трогает. Вызывающий держит замок покупки.
 */
export async function acceptAutomaticCancelRefund(
  tx: BillingPrisma,
  purchaseRef: string,
  returned: { readonly paymentId: string; readonly status: BankStatus },
  now: Date,
): Promise<void> {
  const purchase = await tx.billingPurchase.findUniqueOrThrow({
    where: { id: purchaseRef },
  });
  const { refundableKopecks } = await refundTotals(
    tx,
    purchase.id,
    purchase.amountKopecks,
  );
  if (refundableKopecks <= 0) return;
  await recordBankConfirmedRefund(
    tx,
    purchase,
    {
      amountKopecks: BigInt(refundableKopecks),
      basis: "automatic_cancel",
      reason:
        "Late automatic Cancel of a retired attempt returned the payment; confirmed by T-Bank",
      paymentId: returned.paymentId,
      observedStatus: returned.status,
    },
    now,
  );
}

/**
 * Возврат, который банк уже подтвердил, а владелец не решал: решение без владельца сразу
 * `executed`, попытка возврата сразу `confirmed`. Доступ покупки он не трогает. Возвращает
 * ссылку попытки возврата.
 */
async function recordBankConfirmedRefund(
  tx: BillingPrisma,
  purchase: Purchase,
  refund: {
    readonly amountKopecks: bigint;
    readonly basis: Extract<RefundBasis, "withdrawal" | "automatic_cancel">;
    readonly reason: string;
    readonly paymentId: string;
    readonly observedStatus: string;
  },
  now: Date,
): Promise<string> {
  const decisionRef = randomUUID(),
    refundRef = randomUUID();
  await tx.billingRefundDecision.create({
    data: {
      id: decisionRef,
      purchaseRef: purchase.id,
      accountId: purchase.accountId,
      actorId: null,
      operationId: null,
      amountKopecks: refund.amountKopecks,
      basis: refund.basis,
      access: "keep",
      recurring: "keep",
      reason: refund.reason,
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
      paymentId: refund.paymentId,
      amountKopecks: refund.amountKopecks,
      state: "confirmed",
      observedStatus: refund.observedStatus,
      errorCode: "0",
      createdAt: now,
      updatedAt: now,
    },
  });
  return refundRef;
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
