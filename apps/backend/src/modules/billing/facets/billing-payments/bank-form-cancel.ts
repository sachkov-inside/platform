// Отмена формы снятой попытки в банке (#1923). Попытка, чей Init мог дойти до банка, получает
// отметку `bank_cancel_requested`. Сверка вне транзакции отменяет её неоплаченную форму, а
// закрывает отметку `bank_cancel_confirmed` со статусом банка или `bank_payment_absent` (#1922).
// Правило открытой отметки задаёт `isBankCancelOpen`.
import { z } from "zod";
import {
  type BillingPrisma,
  type BillingPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import {
  bankCancelClosingEventKinds,
  isBankCancelOpen,
  paymentEventKind,
} from "../../domain/payment-events.js";
import { closedFormStatuses } from "../../infrastructure/tbank/bank-statuses.js";
import type { BankPayment } from "../../infrastructure/tbank/tbank.js";
import { bankCancelNotClosedSql } from "../../shared/open-bank-cancel.js";
import { closeAttempt, recordEventOnce } from "./attempt-closure.js";

/**
 * Причина снятия попытки после Init. Имя причины совпадает с именем события снятия:
 * `superseded_by_confirmed_payment` (оплачена другая попытка того же продукта или ссылки),
 * `replaced_by_new_price` (покупка по другой цене, #1925) или `form_address_lost` (у неоплаченной
 * формы нет адреса, #1926). Отметка отмены хранит ту же причину.
 */
const formRetirementSchema = z.discriminatedUnion("reason", [
  z.object({
    reason: z.literal(paymentEventKind.supersededByConfirmedPayment),
    confirmedPurchaseRef: z.uuid(),
  }),
  z.object({
    reason: z.literal(paymentEventKind.replacedByNewPrice),
    replacementPurchaseRef: z.uuid(),
  }),
  z.object({ reason: z.literal(paymentEventKind.formAddressLost) }),
]);
export type FormRetirement = z.infer<typeof formRetirementSchema>;

/**
 * Inside снимает неоплаченную попытку после Init: она закрывается вместе с резервом и получает
 * событие с именем причины. Вызывающий держит замки цен и покупки.
 */
export async function retireAttempt(
  tx: BillingPrisma,
  attemptRef: string,
  retirement: FormRetirement,
  now: Date,
  options: { readonly paymentId?: string; readonly keepLink?: boolean } = {},
): Promise<void> {
  const { reason, ...payload } = retirement;
  await closeAttempt(tx, attemptRef, now, {
    ...options,
    event: { kind: reason, payload },
  });
}

/** Отметка отмены: снятая попытка, чья форма в банке ещё может принять оплату. */
export async function requireBankCancel(
  tx: BillingPrisma,
  attemptRef: string,
  retirement: FormRetirement,
  now: Date,
): Promise<void> {
  await recordEventOnce(
    tx,
    attemptRef,
    paymentEventKind.bankCancelRequested,
    formRetirementSchema.parse(retirement),
    now,
  );
}

/** Открытая отметка отмены этой попытки или `null`. Запись по ответу идёт под замком покупки. */
export async function findOpenBankCancel(
  tx: BillingPrisma,
  purchaseRef: string,
): Promise<FormRetirement | null> {
  const marks = await tx.billingPaymentEvent.findMany({
    where: {
      purchaseRef,
      kind: {
        in: [
          paymentEventKind.bankCancelRequested,
          ...bankCancelClosingEventKinds,
        ],
      },
    },
    select: { kind: true, payload: true },
  });
  if (!isBankCancelOpen(marks.map((mark) => mark.kind))) return null;
  const required = marks.find(
    (mark) => mark.kind === paymentEventKind.bankCancelRequested,
  );
  return required === undefined
    ? null
    : formRetirementSchema.parse(required.payload);
}

/**
 * Банк закрыл форму снятой попытки: Cancel или собственным статусом из `closedFormStatuses`.
 * Другой статус и попытка без открытой отметки ничего не пишут.
 */
export async function closeBankCancel(
  tx: BillingPrisma,
  purchaseRef: string,
  paymentId: string,
  status: BankPayment["Status"],
  now: Date,
): Promise<void> {
  if (
    !closedFormStatuses.includes(status) ||
    (await findOpenBankCancel(tx, purchaseRef)) === null
  )
    return;
  await recordEventOnce(
    tx,
    purchaseRef,
    paymentEventKind.bankCancelConfirmed,
    { paymentId, status },
    now,
  );
}

/**
 * Снятые попытки с открытой отметкой отмены не раньше `markedSince`, чей шаг опроса уже наступил,
 * и время их отметки. Вызывающий отсчитывает `markedSince` окном сверки формы: срок формы идёт от
 * Init, а Init уходит до отметки, поэтому окно от отметки накрывает весь срок формы. Попытка без PaymentId тоже входит: ответ её Init мог потеряться, и
 * платёж ищет CheckOrder. Не больше `limit`.
 */
export async function openRetiredForms(
  prisma: BillingPrismaClient,
  markedSince: Date,
  now: Date,
  limit: number,
): Promise<Map<string, Date>> {
  const rows = z
    .array(z.object({ purchase_ref: z.uuid(), marked_at: z.date() }))
    .parse(
      await prisma.$queryRaw(Prisma.sql`
        SELECT required.purchase_ref, required.occurred_at AS marked_at
        FROM billing.payment_events required
        JOIN billing.purchases purchase ON purchase.id = required.purchase_ref
        WHERE required.kind = ${paymentEventKind.bankCancelRequested}
          AND required.occurred_at >= ${markedSince}
          AND purchase.state = 'failed'
          AND purchase.kind = 'one_time'
          AND (purchase.bank_recheck_at IS NULL OR purchase.bank_recheck_at <= ${now})
          AND ${bankCancelNotClosedSql(Prisma.sql`required.purchase_ref`)}
        ORDER BY purchase.updated_at, purchase.id
        LIMIT ${limit}
      `),
    );
  return new Map(rows.map((row) => [row.purchase_ref, row.marked_at]));
}
