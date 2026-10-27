import "./admin.css";

/**
 * Тон плашки. Тон никогда не говорит один: подпись видна всегда, а форма значка у каждого тона
 * своя (кольцо, точка, ромб, пунктир), поэтому состояние читается и без цвета.
 */
export type AdminStateTone =
  "neutral" | "positive" | "attention" | "critical" | "muted";

export interface AdminStateDefinition {
  readonly label: string;
  readonly tone: AdminStateTone;
}

/**
 * Единственный словарь «состояние → подпись, тон» админки. Новое состояние (оплаты, доступ)
 * добавляется сюда, а не в экран: одно состояние везде называется одним словом и одним тоном.
 */
export const adminStates = {
  "material.draft": { label: "Черновик", tone: "neutral" },
  "material.published": { label: "Опубликован", tone: "positive" },
  "material.unpublished": { label: "Снят с публикации", tone: "muted" },
  "topic.active": { label: "Активна", tone: "positive" },
  "topic.archived": { label: "В архиве", tone: "muted" },
  "product.active": { label: "Активен", tone: "positive" },
  "product.archived": { label: "Архив", tone: "muted" },
  "product.pinned": { label: "На главной", tone: "positive" },
  // Доступ ученика к продукту на вкладке «Ученики» (#1718).
  "holder.active": { label: "Доступ есть", tone: "positive" },
  "holder.revoked": { label: "Доступ отозван", tone: "muted" },
  "submission.awaiting": { label: "Новая", tone: "attention" },
  "submission.commented": { label: "Прокомментирована", tone: "positive" },
  // Продажа продукта (#1718): положительный тон только там, где продажа принимает оплату.
  "sale.unpriced": { label: "Нет цены", tone: "neutral" },
  "sale.closed": { label: "Продажи закрыты", tone: "neutral" },
  "sale.announcement": { label: "Анонс", tone: "neutral" },
  "sale.preorder": { label: "Предзаказ", tone: "positive" },
  "sale.running": { label: "Поток идёт", tone: "positive" },
  "sale.between": { label: "Между потоками", tone: "positive" },
  "sale.archived": { label: "Продукт в архиве", tone: "muted" },
  "sale.priceArchived": { label: "Цена в архиве", tone: "muted" },
  "activationRule.published": { label: "Опубликовано", tone: "positive" },
  "activationRule.paused": { label: "Приостановлено", tone: "muted" },
  // Платёж (#1718): банковское состояние попытки и отдельно готовность доступа. Неизвестное
  // банку состояние остаётся неизвестным и требует сверки, а не читается как «всё в порядке».
  "payment.prepared": { label: "Подготовлен", tone: "neutral" },
  "payment.sent": { label: "Отправлен в банк", tone: "neutral" },
  "payment.pending": { label: "Ждёт оплаты", tone: "neutral" },
  "payment.authorized": { label: "Деньги заблокированы", tone: "neutral" },
  "payment.confirmed": { label: "Оплачен", tone: "positive" },
  "payment.failed": { label: "Не прошёл", tone: "critical" },
  "payment.unknown": { label: "Неизвестно, нужна сверка", tone: "attention" },
  "payment.access.awaiting_payment": {
    label: "Доступ после оплаты",
    tone: "muted",
  },
  "payment.access.preparing": { label: "Доступ готовится", tone: "neutral" },
  "payment.access.review_required": {
    label: "Доступ ждёт проверки",
    tone: "attention",
  },
  "payment.access.ready": { label: "Доступ открыт", tone: "positive" },
  "paymentLink.active": { label: "Готова к оплате", tone: "positive" },
  "paymentLink.pending": { label: "Идёт оплата", tone: "neutral" },
  "paymentLink.unknown": { label: "Уточняем в банке", tone: "attention" },
  "paymentLink.paid": { label: "Оплачена", tone: "positive" },
  "paymentLink.revoked": { label: "Отозвана", tone: "muted" },
  "paymentLink.expired": { label: "Срок истёк", tone: "muted" },
  "paymentLink.changed": { label: "Цена изменилась", tone: "muted" },
  "promotion.active": { label: "Действует", tone: "positive" },
  "promotion.scheduled": { label: "Запланирована", tone: "neutral" },
  "promotion.ended": { label: "Завершилась", tone: "muted" },
  "promotion.exhausted": { label: "Лимит исчерпан", tone: "muted" },
  "promotion.archived": { label: "Архивная", tone: "muted" },
} as const satisfies Record<string, AdminStateDefinition>;

export type AdminStateKey = keyof typeof adminStates;

/** Плашка состояния объекта в строке, карточке или заголовке. Не интерактивна. */
export function StateBadge({ state }: { readonly state: AdminStateKey }) {
  const definition: AdminStateDefinition = adminStates[state];
  return (
    <span
      className="admin-badge"
      data-state={state}
      data-tone={definition.tone}
    >
      <span aria-hidden="true" className="admin-badge-mark" />
      {definition.label}
    </span>
  );
}
