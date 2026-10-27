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
  "submission.awaiting": { label: "Новая", tone: "attention" },
  "submission.commented": { label: "Прокомментирована", tone: "positive" },
  "access.active": { label: "Доступ открыт", tone: "positive" },
  "access.revoked": { label: "Доступ отозван", tone: "muted" },
  "telegram.linked": { label: "Связан", tone: "positive" },
  "telegram.not_linked": { label: "Не связан", tone: "muted" },
  "telegram.member": { label: "В группе", tone: "positive" },
  "telegram.not_member": { label: "Не в группе", tone: "muted" },
  "telegram.unrestricted": { label: "Без ограничений", tone: "neutral" },
  "telegram.moderated": { label: "Ограничен модерацией", tone: "attention" },
  "telegram.restricted_outside": {
    label: "Ограничен вне платформы",
    tone: "attention",
  },
  "telegram.subscribed": { label: "Получает рассылку", tone: "neutral" },
  "telegram.stopped": { label: "Отказался через /stop", tone: "muted" },
  "telegram.unknown": { label: "Неизвестно", tone: "neutral" },
  "waitlist.active": { label: "В списке", tone: "positive" },
  "waitlist.inactive": { label: "Вышел из списка", tone: "muted" },
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
