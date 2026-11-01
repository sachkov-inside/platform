import {
  lockBillingPricing,
  lockBillingPurchase,
  type BillingPrisma,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { paymentEventKind } from "../../domain/payment-events.js";
import { BankInitRefused } from "../../infrastructure/tbank/tbank.js";
import { closeAttempt, recordEventOnce } from "./attempt-closure.js";

/**
 * В банке нет платежа попытки (#1922): Init не ушёл, банк отказал без PaymentId или CheckOrder
 * не находит платежей заказа. Событие `bank_payment_absent` закрывает попытку и её отметку
 * отмены: отменять в банке нечего.
 */
type BankPaymentAbsence =
  | { readonly reason: "init_not_sent" }
  | {
      readonly reason: "init_declined";
      readonly errorCode: string;
      readonly message: string | null;
    }
  | { readonly reason: "check_order_empty"; readonly firstEmptyAt: string };

/**
 * Окно отсутствия платежа. Попытку без PaymentId закрывает пустой ответ CheckOrder не раньше
 * этого срока после первого пустого ответа и после создания покупки. Ответ Init ждёт не дольше
 * `bankTimeoutMs`, поэтому платёж, созданный потерянным Init, CheckOrder покажет задолго до
 * конца окна. Непустой ответ без сохранённого PaymentId окно не сбрасывает.
 */
const bankPaymentAbsenceWindowMilliseconds = 30 * 60 * 1000;

/**
 * Сбой Init, после которого в банке точно нет платежа: Init не был вызван, адаптер не отправил
 * запрос или банк отказал без PaymentId. Иначе `null`: исход неизвестен.
 */
export function initAbsence(
  error: unknown,
  initRequested: boolean,
): BankPaymentAbsence | null {
  if (!initRequested) return { reason: "init_not_sent" };
  if (!(error instanceof BankInitRefused)) return null;
  const { refusal } = error;
  return refusal.reason === "declined"
    ? {
        reason: "init_declined",
        errorCode: refusal.errorCode,
        message: refusal.message,
      }
    : { reason: "init_not_sent" };
}

/**
 * В банке нет платежа попытки. Попытка в `sent` или `unknown` закрывается вместе с резервом, и
 * покупатель может начать новую покупку. Снятая раньше попытка получает только событие: оно
 * закрывает её отметку отмены. Попытка с PaymentId или в другом состоянии не меняется.
 * Вызывающий держит замок цен.
 */
export async function recordBankPaymentAbsent(
  tx: BillingPrisma,
  purchaseRef: string,
  absence: BankPaymentAbsence,
  now: Date,
): Promise<void> {
  await lockBillingPurchase(tx, purchaseRef);
  const row = await tx.billingPurchase.findUniqueOrThrow({
    where: { id: purchaseRef },
    select: { state: true, paymentId: true },
  });
  if (row.paymentId !== null) return;
  if (row.state === "sent" || row.state === "unknown")
    await closeAttempt(tx, purchaseRef, now);
  else if (row.state !== "failed") return;
  await recordEventOnce(
    tx,
    purchaseRef,
    paymentEventKind.bankPaymentAbsent,
    absence,
    now,
  );
}

/**
 * CheckOrder не нашёл платежей заказа без PaymentId. Первый такой ответ пишет `bank_order_empty`.
 * Попытку закрывает пустой ответ не раньше `bankPaymentAbsenceWindowMilliseconds` после него
 * и после создания покупки. Найденный за это время платёж даёт PaymentId, и попытка уходит
 * из этой ветки. Пока окно идёт, исход остаётся неизвестным, а сверка ждёт: `deferred`. Это
 * не сбой банка, поэтому ни задание сверки, ни покупатель не получают ошибку.
 */
export async function settleEmptyOrder(
  prisma: BillingPrismaClient,
  purchaseRef: string,
  clock: () => Date,
): Promise<"closed" | "deferred"> {
  return await prisma.$transaction(async (tx) => {
    await lockBillingPricing(tx);
    await lockBillingPurchase(tx, purchaseRef);
    const row = await tx.billingPurchase.findUniqueOrThrow({
      where: { id: purchaseRef },
      select: { state: true, paymentId: true, createdAt: true },
    });
    // `sent` остаётся после аварии процесса во время Init: ответ Init не дольше
    // `bankTimeoutMs`, поэтому окно закрывает её так же, как `unknown`.
    if (
      row.paymentId !== null ||
      !["sent", "unknown", "failed"].includes(row.state)
    )
      return "deferred";
    const now = clock();
    const first = await tx.billingPaymentEvent.findUnique({
      where: {
        purchaseRef_kind: {
          purchaseRef,
          kind: paymentEventKind.bankOrderEmpty,
        },
      },
      select: { occurredAt: true },
    });
    if (first === null) {
      await recordEventOnce(
        tx,
        purchaseRef,
        paymentEventKind.bankOrderEmpty,
        {},
        now,
      );
      return "deferred";
    }
    if (
      now.getTime() - first.occurredAt.getTime() <
        bankPaymentAbsenceWindowMilliseconds ||
      now.getTime() - row.createdAt.getTime() <
        bankPaymentAbsenceWindowMilliseconds
    )
      return "deferred";
    await recordBankPaymentAbsent(
      tx,
      purchaseRef,
      {
        reason: "check_order_empty",
        firstEmptyAt: first.occurredAt.toISOString(),
      },
      now,
    );
    return "closed";
  });
}
