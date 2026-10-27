import type { BillingFailureCode, PaymentLink } from "@/entities/subscription";
import type { AdminStateKey } from "@/shared/ui/admin";

import type { PaymentLinkState } from "./payment-link-operations";

/** Фильтр списка ссылок: продукт и видимое состояние; `null` значит «все». */
export interface PaymentLinksFilter {
  readonly productId: string | null;
  readonly state: PaymentLinkState | null;
}
export const allPaymentLinks: PaymentLinksFilter = {
  productId: null,
  state: null,
};

export const paymentLinkStates = [
  "active",
  "pending",
  "unknown",
  "paid",
  "revoked",
  "expired",
  "changed",
] as const satisfies readonly PaymentLinkState[];

export function paymentLinkBadge(state: PaymentLinkState): AdminStateKey {
  return `paymentLink.${state}`;
}

/** Название продукта ссылки из её снимка; прежний снимок без продукта называет предложение. */
export function paymentLinkTitle(link: PaymentLink): string {
  return link.snapshot.product?.name ?? link.snapshot.offer.name;
}

/** По ссылке уже нельзя оплатить: она оплачена, отозвана, её срок истёк или цена изменилась. */
export function paymentLinkClosed(link: PaymentLink): boolean {
  return (
    link.state === "paid" ||
    link.state === "revoked" ||
    link.state === "expired" ||
    link.state === "changed"
  );
}

/** Ссылку можно отозвать, пока по ней не началась оплата и она действует. */
export function canRevokePaymentLink(link: PaymentLink): boolean {
  return link.state === "active";
}

type FailureMessages = Partial<Record<BillingFailureCode, string>>;

const commonMessages: FailureMessages = {
  unauthorized: "Сессия закончилась. Войдите снова и повторите.",
  forbidden: "Ссылками на оплату управляет владелец с правом billing:manage.",
  invalid_request: "Сервер не принял данные. Проверьте форму и повторите.",
  operation_conflict:
    "Это действие уже выполнено с другими данными. Обновите данные и повторите.",
};
const unavailableMessage =
  "Сервис оплаты сейчас не отвечает. Повторите: повтор не создаст второй ссылки и не отзовёт её дважды.";

const createMessages: FailureMessages = {
  ...commonMessages,
  revision_conflict:
    "Цена продукта изменилась. Обновите данные и создайте ссылку заново.",
  state_conflict:
    "Цена продукта изменилась. Обновите данные и создайте ссылку заново.",
  not_found:
    "Цена продукта не найдена. Возможно, её сняли с продажи. Обновите данные.",
};

const revokeMessages: FailureMessages = {
  ...commonMessages,
  reservation_conflict:
    "По ссылке уже началась оплата. Дождитесь результата банка.",
  payment_in_progress:
    "По ссылке уже началась оплата. Дождитесь результата банка.",
  revision_conflict:
    "Ссылка изменилась в другом месте. Обновите данные и проверьте её состояние.",
  state_conflict:
    "Ссылку уже нельзя отозвать: она оплачена, отозвана или её срок истёк.",
  not_found: "Ссылка не найдена. Обновите данные.",
};

/** Отказ создания ссылки словами владельца. */
export function createFailureMessage(code: BillingFailureCode): string {
  return createMessages[code] ?? unavailableMessage;
}

/** Отказ отзыва ссылки словами владельца. */
export function revokeFailureMessage(code: BillingFailureCode): string {
  return revokeMessages[code] ?? unavailableMessage;
}
