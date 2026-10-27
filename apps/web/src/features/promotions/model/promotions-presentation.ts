import type { BillingFailureCode } from "@/entities/subscription";
import { formatMoscowDate } from "@/shared/lib/moscow-format";

import { promotionEndDate, promotionStartDate } from "./promotion-form";
import type { PromotionListItem } from "./promotion-operations";

/** Что показывает страница «Скидки»: скидки владельца или архив анкетных скидок. */
export type DiscountsView = "promotions" | "questionnaire";

/** Фильтр списка скидок: продукт и архив. */
export interface PromotionsFilter {
  readonly view: DiscountsView;
  readonly productId: string | null;
  readonly archived: boolean;
}
export const defaultPromotionsFilter: PromotionsFilter = {
  view: "promotions",
  productId: null,
  archived: false,
};

/** Область скидки словами: список продуктов, «Все продукты» или прежняя область. */
export type PromotionScope =
  | { readonly kind: "all" }
  | { readonly kind: "legacy" }
  | { readonly kind: "products"; readonly names: readonly string[] };

export function promotionScope(
  promotion: Pick<PromotionListItem, "productIds" | "legacy">,
  productName: (productId: string) => string | undefined,
): PromotionScope {
  if (promotion.legacy) return { kind: "legacy" };
  if (promotion.productIds.length === 0) return { kind: "all" };
  return {
    kind: "products",
    names: promotion.productIds.map(
      (id) => productName(id) ?? "Продукт без цены",
    ),
  };
}

/** Область скидки словами: «Все продукты», прежние предложения или названия продуктов. */
export function scopeText(scope: PromotionScope): string {
  switch (scope.kind) {
    case "all":
      return "Все продукты";
    case "legacy":
      return "Прежние предложения";
    case "products":
      return scope.names.join(", ");
  }
}

/** «1 нояб. 2026 – 30 нояб. 2026»: последний день включительно, по Москве. */
export function promotionPeriodLabel(
  promotion: Pick<PromotionListItem, "startsAt" | "endsAt">,
): string {
  const first = promotionStartDate(promotion.startsAt);
  const last = promotionEndDate(promotion.endsAt);
  return first === last
    ? formatMoscowDate(first)
    : `${formatMoscowDate(first)} – ${formatMoscowDate(last)}`;
}

/** Почему скидку из списка можно только посмотреть: архив, прежняя область или анкета. */
export function promotionReadOnlyReason(
  promotion: Pick<PromotionListItem, "archived" | "legacy" | "questionnaire">,
): string {
  if (promotion.archived)
    return "Скидка в архиве. Изменить её нельзя: для новых покупок создайте новую.";
  if (promotion.legacy)
    return "Скидка прежней области. Её можно только посмотреть: область задана по прежним предложениям.";
  return "Анкетная скидка. Её можно только посмотреть: анкетные скидки из админки больше не меняются.";
}

const countFormat = new Intl.NumberFormat("ru-RU");

/** «12 из 50» или «12, без лимита». */
export function promotionUsageLabel(
  promotion: Pick<PromotionListItem, "usedCount" | "usageLimit">,
): string {
  return promotion.usageLimit === null
    ? `${countFormat.format(promotion.usedCount)}, без лимита`
    : `${countFormat.format(promotion.usedCount)} из ${countFormat.format(promotion.usageLimit)}`;
}

type FailureMessages = Partial<Record<BillingFailureCode, string>>;

const commonMessages: FailureMessages = {
  unauthorized: "Сессия закончилась. Войдите снова и повторите.",
  forbidden: "Скидками управляет владелец с правом billing:manage.",
};
const unavailableMessage =
  "Сервис оплаты сейчас не отвечает. Повторите: повтор не создаст вторую скидку.";

const saveMessages: FailureMessages = {
  ...commonMessages,
  revision_conflict:
    "Скидку изменили в другом месте. Обновите данные и внесите правку заново.",
  operation_conflict:
    "Это сохранение уже выполнено с другими данными. Обновите данные и повторите.",
  invalid_request:
    "Сервер не принял скидку. Проверьте даты, процент и продукты.",
  not_found: "Скидка или один из продуктов не найдены. Обновите данные.",
};

const archiveMessages: FailureMessages = {
  ...commonMessages,
  revision_conflict:
    "Скидку изменили в другом месте. Обновите данные и проверьте её.",
  not_found: "Скидка не найдена. Обновите данные.",
};

export function saveFailureMessage(code: BillingFailureCode): string {
  return saveMessages[code] ?? unavailableMessage;
}

export function archiveFailureMessage(code: BillingFailureCode): string {
  return archiveMessages[code] ?? unavailableMessage;
}
