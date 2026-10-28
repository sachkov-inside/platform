import type { BillingFailureCode } from "./billing-contract";

/**
 * Чтение billing через BFF не удалось. Код отказа остаётся в ошибке запроса, чтобы экран отличил
 * запрет (нет права `billing:manage`: повтор не поможет) от недоступности (повтор поможет).
 */
export class BillingReadError extends Error {
  constructor(readonly code: BillingFailureCode) {
    super(`Billing read failed: ${code}`);
  }
}

/** Ошибка запроса означает отказ в праве, а не сбой: показывается отказ без повтора и действий. */
export function isBillingRefusal(error: unknown): boolean {
  return error instanceof BillingReadError && error.code === "forbidden";
}
