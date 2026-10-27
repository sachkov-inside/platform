import { attemptStateLabel, attemptStateSchema } from "@/entities/subscription";
import type { AdminStateKey } from "@/shared/ui/admin";
import {
  formatCountRu,
  formatMoscowDate,
  formatMoscowDateTime,
} from "@/shared/lib/moscow-format";

import type {
  PersonCard,
  PersonCardHistoryEntry,
  PersonCardLearning,
  PersonCardTelegram,
} from "./person-card";

/** Якоря карточки в порядке решения владельца 10: одна страница, переход по разделам. */
export const personCardSections = [
  { id: "products", label: "Продукты и история" },
  { id: "payments", label: "Оплаты и ссылки" },
  { id: "learning", label: "Обучение" },
  { id: "telegram", label: "Telegram" },
  { id: "waitlists", label: "Списки ожидания" },
] as const;

export type PersonCardSectionId = (typeof personCardSections)[number]["id"];

const historyLabels: Readonly<Record<PersonCardHistoryEntry["kind"], string>> =
  {
    purchase: "Покупка",
    activation: "Активация курса",
    manual_issue: "Выдача",
    transfer: "Перенос",
    revoke: "Отзыв",
    restore: "Восстановление",
    migrate: "Перенос из прежней системы",
    other: "Другое событие",
  };

export function historyKindLabel(kind: PersonCardHistoryEntry["kind"]): string {
  return historyLabels[kind];
}

/** Кто выполнил действие: подпись человека, «Система» или «Автор неизвестен», но не UUID. */
export function historyActorLabel(
  actor: PersonCardHistoryEntry["actor"],
): string {
  switch (actor.kind) {
    case "system":
      return "Система";
    case "unknown":
      return "Автор неизвестен";
    case "person":
      return actor.label ?? "Аккаунт без имени и email";
  }
}

/** Состояние оплаты словами Billing; незнакомое значение не превращается в техническое слово. */
export function paymentStateText(state: string): string {
  const known = attemptStateSchema.safeParse(state);
  return known.success ? attemptStateLabel(known.data) : "Состояние уточняется";
}

/** Оплаты, прошедшие по ссылке на оплату: подпись строки без ID ссылки. */
export function paidLinks(
  payments: Extract<PersonCard["payments"], { readonly state: "ready" }>,
) {
  return payments.items.filter((payment) => payment.paymentLinkId !== null);
}

/** «Прочитано 12 из 40 · 30%» или «Ещё не начато»; без прогресса ничего не придумывается. */
export function learningProgressText(learning: PersonCardLearning): string {
  if (learning.progress.state === "unavailable")
    return "Прогресс временно недоступен";
  const { read, total } = learning.progress;
  if (total === 0) return "В продукте пока нет материалов";
  const percent = Math.round((read / total) * 100);
  return `Прочитано ${String(read)} из ${String(total)} · ${String(percent)}%`;
}

export function learningStartText(learning: PersonCardLearning): string {
  return learning.startedAt === null
    ? "Ещё не начато"
    : `Начато ${formatMoscowDate(learning.startedAt)}`;
}

export function learningActivityText(learning: PersonCardLearning): string {
  if (learning.progress.state === "unavailable") return "";
  return learning.progress.lastActivityAt === null
    ? "Активности ещё не было"
    : `Последняя активность ${formatMoscowDateTime(learning.progress.lastActivityAt)}`;
}

const submissionForms = ["сдача", "сдачи", "сдач"] as const;

/** «3 сдачи, последняя 12 окт. 2026, 14:05». Email рядом со сдачами не показывается. */
export function submissionsText(submission: {
  readonly count: number;
  readonly lastSubmittedAt: string;
}): string {
  return `${formatCountRu(submission.count, submissionForms)}, последняя ${formatMoscowDateTime(submission.lastSubmittedAt)}`;
}

export interface TelegramFact {
  readonly label: string;
  readonly state: AdminStateKey;
}

/**
 * Факты Telegram плашками. Неизвестное состояние остаётся «Неизвестно», а не превращается в
 * «нет» или «в порядке».
 */
export function telegramFacts(
  telegram: Extract<PersonCardTelegram, { readonly state: "ready" }>,
): readonly TelegramFact[] {
  return [
    {
      label: "Связь с аккаунтом",
      state:
        telegram.link === "linked" ? "telegram.linked" : "telegram.not_linked",
    },
    {
      label: "Группа продукта",
      state:
        telegram.membership === "member"
          ? "telegram.member"
          : telegram.membership === "not_member"
            ? "telegram.not_member"
            : "telegram.unknown",
    },
    {
      label: "Ограничения",
      state:
        telegram.restriction === "none"
          ? "telegram.unrestricted"
          : telegram.restriction === "moderation"
            ? "telegram.moderated"
            : telegram.restriction === "external_unknown"
              ? "telegram.restricted_outside"
              : "telegram.unknown",
    },
    {
      label: "Рассылка бота",
      state:
        telegram.marketing === "enabled"
          ? "telegram.subscribed"
          : telegram.marketing === "stopped"
            ? "telegram.stopped"
            : "telegram.unknown",
    },
  ];
}

export function telegramObservedText(observedAt: string | null): string {
  return observedAt === null
    ? "Бот ещё не проверял состояние в группе."
    : `Состояние в группе проверено ${formatMoscowDateTime(observedAt)}.`;
}

/** Название продукта для строки другого блока: из продуктов, затем из обучения. */
export function productNameOf(card: PersonCard, productId: string): string {
  const fromProducts =
    card.products.state === "ready"
      ? card.products.items.find((item) => item.productId === productId)?.name
      : undefined;
  const fromLearning =
    card.learning.state === "ready"
      ? card.learning.items.find((item) => item.productId === productId)?.name
      : undefined;
  return fromProducts ?? fromLearning ?? "Продукт";
}

/** Ссылка на Telegram для `href`: только https, иначе ссылки нет и @username остаётся текстом. */
export function telegramHref(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
