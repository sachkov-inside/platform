// Статусы платежа T-Bank и их классы: единственное место, где billing решает, что значит статус
// банка. Справочник статусов: https://developer.tbank.ru/eacq/intro/developer/operation-statuses
import { z } from "zod";

/**
 * Все 23 статуса платежа из справочника T-Bank на 31.10.2026 и `RECEIPT`.
 * `RECEIPT` не входит в справочник: это уведомление о чеке, а не о платеже.
 */
export const bankPaymentStatuses = [
  "RECEIPT",
  "NEW",
  "FORM_SHOWED",
  "ATTEMPTS_EXPIRED",
  "DEADLINE_EXPIRED",
  "CANCELED",
  "PREAUTHORIZING",
  "3DS_CHECKING",
  "3DS_CHECKED",
  "AUTHORIZING",
  "PAY_CHECKING",
  "AUTHORIZED",
  "AUTH_FAIL",
  "REJECTED",
  "CONFIRMING",
  "CONFIRM_CHECKING",
  "CONFIRMED",
  "REVERSING",
  "PARTIAL_REVERSED",
  "REVERSED",
  "REFUNDING",
  "ASYNC_REFUNDING",
  "PARTIAL_REFUNDED",
  "REFUNDED",
] as const;
export type BankPaymentStatus = (typeof bankPaymentStatuses)[number];
/**
 * Подписанный статус вне справочника: банк может добавить новый статус раньше, чем Inside. Такой
 * статус принимается, а покупка уходит на сверку. Он состоит, как статусы справочника, из заглавных
 * латинских букв, цифр и `_` и не длиннее 64 символов.
 */
const unrecognizedStatusSchema = z
  .string()
  .regex(/^[A-Z0-9_]{1,64}$/u)
  .brand<"UnrecognizedBankStatus">();
/** Статус платежа в ответе или уведомлении банка: из справочника или неизвестный. */
export const bankStatusSchema = z.union([
  z.enum(bankPaymentStatuses),
  unrecognizedStatusSchema,
]);
export type BankStatus = z.infer<typeof bankStatusSchema>;

export function isRecognizedBankStatus(
  status: BankStatus,
): status is BankPaymentStatus {
  return (bankPaymentStatuses as readonly string[]).includes(status);
}

/**
 * Статусы неоплаченной формы. Только у них Cancel закрывает форму без движения денег
 * (решение владельца 31.10.2026, #1921): https://developer.tbank.ru/eacq/api/cancel
 */
export const unpaidFormStatuses: readonly BankStatus[] = ["NEW", "FORM_SHOWED"];

/** Отказ банка по попытке. Тот же PaymentId ещё может прийти подтверждённым. */
export const declinedStatuses: readonly BankStatus[] = [
  "REJECTED",
  "AUTH_FAIL",
  "CANCELED",
  "ATTEMPTS_EXPIRED",
  "DEADLINE_EXPIRED",
  "REVERSED",
];

/**
 * Банк ещё не решил исход операции: деньги могли уже двигаться, поэтому покупка ждёт сверки.
 * `PAY_CHECKING` и `CONFIRM_CHECKING` банк ставит, когда сам не знает исход авторизации.
 */
export const undecidedStatuses: readonly BankStatus[] = [
  "PAY_CHECKING",
  "CONFIRM_CHECKING",
  "REVERSING",
  "REFUNDING",
  "ASYNC_REFUNDING",
];

/** Итог возврата или отмены уже списанного либо удержанного платежа. */
export const refundTerminalStatuses: readonly BankStatus[] = [
  "REFUNDED",
  "PARTIAL_REFUNDED",
  "REVERSED",
  "PARTIAL_REVERSED",
];

/** Полный возврат списанного (`REFUNDED`) или отмена удержанного (`REVERSED`) платежа. */
export const fullReturnStatuses: readonly BankStatus[] = [
  "REFUNDED",
  "REVERSED",
];

/**
 * Частичный возврат подтверждённого (`PARTIAL_REFUNDED`) или авторизованного (`PARTIAL_REVERSED`)
 * платежа. Его Amount не равен сумме покупки и не доказывает сумму возврата.
 */
export const partialReturnStatuses: readonly BankStatus[] = [
  "PARTIAL_REFUNDED",
  "PARTIAL_REVERSED",
];

/**
 * После этих статусов форма уже не принимает оплату, и Cancel ей не нужен. `PARTIAL_REFUNDED`
 * доказывает, что форма оплачена: подтверждение такой оплаты закрывает отметку отмены.
 */
export const closedFormStatuses: readonly BankStatus[] = [
  "CANCELED",
  "ATTEMPTS_EXPIRED",
  "DEADLINE_EXPIRED",
  "REVERSED",
  "CONFIRMED",
  "REFUNDED",
  "PARTIAL_REFUNDED",
];

/** Статус из класса `statuses`. Принимает и статус ответа Cancel, который банк присылает строкой. */
export function bankStatusIn(
  statuses: readonly BankStatus[],
  status: string,
): boolean {
  return (statuses as readonly string[]).includes(status);
}
