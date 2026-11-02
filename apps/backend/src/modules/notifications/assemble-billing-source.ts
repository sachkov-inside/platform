import type { BillingNotices, BillingPayments } from "../billing/index.js";
import type { NotificationEvent } from "./domain/notification-wire.js";
import type { NotificationSource } from "./ports/notification-sources.js";

/**
 * Повод Billing для Nest и для композиции процессов и тестов. Повод продажи дополняется адресом
 * заказа покупателя: он неизменяем у покупки, поэтому повторная сборка текста перед отправкой
 * совпадает с выпущенной командой. Недоступный адрес — состояние зависимости, повод подождёт.
 */
export function resolveBillingSource(
  notices: Pick<BillingNotices, "resolveNotice">,
  payments: Pick<BillingPayments, "purchaseEmail">,
): (event: NotificationEvent) => Promise<NotificationSource> {
  return async (event) => {
    const source = await notices.resolveNotice(event);
    if (source.status !== "current") return source;
    const { promotion, ...current } = source;
    if (current.audience !== "sales_managers") return current;
    if (current.purchaseRef === undefined) return { status: "superseded" };
    const email = await payments.purchaseEmail(
      current.event.accountRef,
      current.purchaseRef,
    );
    if (!email.ok) return { status: "unavailable" };
    return {
      ...current,
      sale: { buyerEmail: email.value, promotion: promotion ?? null },
    };
  };
}
