import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { z } from "zod";

/** Ответ банка об исходе: статус, признак успеха и код ошибки всегда приходят вместе. */
export interface BankOutcome {
  readonly status: string;
  readonly success: boolean;
  readonly errorCode: string;
}

/** Исходы оплаты, которые стенд воспроизводит по требованию владельца. */
export const paymentOutcomes = {
  confirmed: { label: "Оплата прошла", status: "CONFIRMED", success: true, errorCode: "0" },
  rejected: { label: "Банк отказал", status: "REJECTED", success: false, errorCode: "1051" },
  canceled: { label: "Покупатель отменил", status: "CANCELED", success: false, errorCode: "0" },
  expired: { label: "Истёк срок оплаты", status: "DEADLINE_EXPIRED", success: false, errorCode: "0" },
  // Ответ без однозначного исхода: приложение обязано оставить попытку на сверку, а не списать снова.
  unknown: { label: "Непонятный ответ банка", status: "CONFIRMING", success: false, errorCode: "9999" },
} as const satisfies Record<string, BankOutcome & { label: string }>;
export type PaymentOutcome = keyof typeof paymentOutcomes;

export const bindingOutcomes = {
  completed: { label: "Карта привязана", status: "COMPLETED", success: true, errorCode: "0" },
  rejected: { label: "Привязка отклонена", status: "REJECTED", success: false, errorCode: "3000" },
} as const satisfies Record<string, BankOutcome & { label: string }>;
export type BindingOutcome = keyof typeof bindingOutcomes;

/** Списание по сохранённой карте и возврат идут без покупателя: их исход выбирается заранее. */
export const chargeOutcomes = ["confirmed", "rejected", "unknown"] as const satisfies readonly PaymentOutcome[];
export type ChargeOutcome = typeof chargeOutcomes[number];
export const refundOutcomes = { accepted: "Банк возвращает", declined: "Банк отказывает" } as const;
export type RefundOutcome = keyof typeof refundOutcomes;

/** Банк не знает незнакомой операции: `7` — его собственный код «операция не найдена». */
export const unknownOperationOutcome: BankOutcome = { status: "UNKNOWN", success: false, errorCode: "7" };
export const declinedBindingOutcome: BankOutcome = { status: "REJECTED", success: false, errorCode: "3005" };

export const isKnownOutcome = <T extends object>(table: T, value: string): value is Extract<keyof T, string> =>
  Object.hasOwn(table, value);
export const isChargeOutcome = (value: string): value is ChargeOutcome =>
  chargeOutcomes.some(outcome => outcome === value);

/** Ссылки банка — числовые строки: так их и видит владелец в журнале приложения. */
export const bankReference = (digits: number): string => {
  const lowest = 10 ** (digits - 1);
  return `${Math.floor(Math.random() * lowest * 9) + lowest}`;
};

// Исход записан в журнал той же тройкой, какой он приходит в ответе банка.
const outcomeShape = { status: z.string(), success: z.boolean(), errorCode: z.string() };
const refundSchema = z.object({ ...outcomeShape, newAmount: z.int().nonnegative() });
const orderSchema = z.object({
  ...outcomeShape,
  orderId: z.string(), paymentId: z.string(), amount: z.int().nonnegative(), description: z.string(),
  email: z.string(), recurrent: z.boolean(), notificationUrl: z.string(),
  rebillId: z.string().optional(), refundedKopecks: z.int().nonnegative(),
  refunds: z.array(z.tuple([z.string(), refundSchema])),
});
const bindingSchema = z.object({
  ...outcomeShape, requestKey: z.string(), customerKey: z.string(), rebillId: z.string().optional(),
});
const ledgerSchema = z.object({
  orders: z.array(orderSchema), bindings: z.array(bindingSchema),
  savedMethods: z.array(z.string()),
  chargeOutcome: z.enum(chargeOutcomes), refundOutcome: z.enum(["accepted", "declined"]),
});
export type RefundRecord = z.infer<typeof refundSchema>;
export type StoredOrder = z.infer<typeof orderSchema>;
export type BindingRecord = z.infer<typeof bindingSchema>;
export type BankLedger = z.infer<typeof ledgerSchema>;
export type OrderRecord = Omit<StoredOrder, "refunds"> & { refunds: Map<string, RefundRecord> };

export const emptyLedger = (): BankLedger =>
  ({ orders: [], bindings: [], savedMethods: [], chargeOutcome: "confirmed", refundOutcome: "accepted" });

/**
 * Журнал двойника. Настоящий банк не забывает платёж, поэтому и стенд переживает свой перезапуск:
 * иначе незавершённая попытка приложения осталась бы несводимой навсегда. Испорченный файл не
 * останавливает стенд — он начинает с пустого журнала и говорит об этом в лог.
 */
export function loadBankLedger(path: string | undefined): BankLedger {
  if (path === undefined) return emptyLedger();
  let stored: unknown;
  // Первый запуск — обычное дело: файла ещё нет. Испорченное содержимое разбирается ниже.
  try { stored = JSON.parse(readFileSync(path, "utf8")); } catch { return emptyLedger(); }
  const parsed = ledgerSchema.safeParse(stored);
  if (parsed.success) return parsed.data;
  console.warn(JSON.stringify({ process: "bank-double", ledger: "unreadable", path }));
  return emptyLedger();
}

export function saveBankLedger(path: string | undefined, ledger: BankLedger): void {
  if (path === undefined) return;
  const pending = `${path}.pending`;
  writeFileSync(pending, JSON.stringify(ledger), "utf8");
  renameSync(pending, path);
}
