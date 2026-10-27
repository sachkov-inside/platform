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

/** Ссылку можно отозвать, пока по ней не началась оплата и она действует. */
export function canRevokePaymentLink(link: PaymentLink): boolean {
  return link.state === "active";
}

/** Отказ создания ссылки словами владельца. */
export function createFailureMessage(code: BillingFailureCode): string {
  switch (code) {
    case "revision_conflict":
    case "state_conflict":
      return "Цена продукта изменилась. Обновите данные и создайте ссылку заново.";
    case "not_found":
      return "Цена продукта не найдена. Возможно, её сняли с продажи. Обновите данные.";
    default:
      return commonFailureMessage(code);
  }
}

/** Отказ отзыва ссылки словами владельца. */
export function revokeFailureMessage(code: BillingFailureCode): string {
  switch (code) {
    case "reservation_conflict":
    case "payment_in_progress":
      return "По ссылке уже началась оплата. Дождитесь результата банка.";
    case "revision_conflict":
      return "Ссылка изменилась в другом месте. Обновите данные и проверьте её состояние.";
    case "state_conflict":
      return "Ссылку уже нельзя отозвать: она оплачена, отозвана или её срок истёк.";
    case "not_found":
      return "Ссылка не найдена. Обновите данные.";
    default:
      return commonFailureMessage(code);
  }
}

export function commonFailureMessage(code: BillingFailureCode): string {
  switch (code) {
    case "unauthorized":
      return "Сессия закончилась. Войдите снова и повторите.";
    case "forbidden":
      return "Ссылками на оплату управляет владелец с правом billing:manage.";
    case "invalid_request":
      return "Сервер не принял данные. Проверьте форму и повторите.";
    case "operation_conflict":
      return "Это действие уже выполнено с другими данными. Обновите данные и повторите.";
    default:
      return "Сервис оплаты сейчас не отвечает. Повторите: повтор не создаст второй ссылки и не отзовёт её дважды.";
  }
}
