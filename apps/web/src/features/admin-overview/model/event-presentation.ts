import type { Route } from "next";

import { formatRubles } from "@/shared/lib/moscow-format";
import { hasText } from "@/shared/lib/text";
import {
  authoringPersonHref,
  authoringProductEditorHref,
} from "@/shared/routing/authoring";
import { internalRoute } from "@/shared/routing/internal-route";

import { overviewOriginLabels } from "./metric-presentation";
import type { OverviewEvent, OverviewEventPerson } from "./overview-contract";

/** Как событие выглядит в ленте: что случилось, с кем, где и когда. */
export interface OverviewEventRow {
  readonly key: string;
  readonly kind: OverviewEvent["kind"];
  /** «Оплата 4 990 ₽», «Выдан доступ», «Новая сдача». */
  readonly title: string;
  /** Уточнение после заголовка: способ выдачи или задание. */
  readonly detail: string | null;
  readonly person: {
    readonly label: string;
    /** Подпись есть только у человека с именем или @username в Telegram. */
    readonly named: boolean;
    /** Карточка человека, если она открыта зрителю. */
    readonly href: Route | null;
  };
  readonly product: { readonly name: string; readonly href: Route } | null;
  /** Страница платежа или сдачи. */
  readonly href: Route | null;
  readonly occurredAt: string;
}

/**
 * Подпись человека: имя Telegram, затем @username, иначе нейтральная подпись. Email в Обзоре нет:
 * лента стоит рядом со сдачами, а privacy-v5 исключает email рядом с ними.
 */
export function eventPersonLabel(person: OverviewEventPerson): {
  readonly label: string;
  readonly named: boolean;
} {
  const name = person.name?.trim();
  if (hasText(name)) return { label: name, named: true };
  const username = person.username?.trim();
  if (hasText(username)) return { label: `@${username}`, named: true };
  return { label: "Без имени в Telegram", named: false };
}

/**
 * Событие → строка ленты. `peopleLinks` говорит, открыта ли зрителю карточка человека: ее читает
 * только аккаунт с правом управлять доступом и оплатами.
 */
export function overviewEventRow(
  event: OverviewEvent,
  { peopleLinks }: { readonly peopleLinks: boolean },
): OverviewEventRow {
  const known = eventPersonLabel(event.person);
  // Без права на карточку имя и @username не приходят: подпись говорит, что имя скрыто, а не
  // что его нет.
  const person =
    known.named || peopleLinks ? known : { label: "Имя скрыто", named: false };
  const base = {
    kind: event.kind,
    occurredAt: event.occurredAt,
    person: {
      ...person,
      href: peopleLinks ? authoringPersonHref(event.person.accountId) : null,
    },
    product:
      event.product === null
        ? null
        : {
            name: event.product.name,
            href: authoringProductEditorHref(event.product.id),
          },
  };
  switch (event.kind) {
    case "payment_confirmed":
      return {
        ...base,
        key: `payment:${event.purchaseRef}`,
        title: `Оплата ${formatRubles(Math.round(event.amountKopecks / 100) * 100)}`,
        detail: null,
        href: internalRoute(`/authoring/sales/payments/${event.purchaseRef}`),
      };
    case "access_issued":
      return {
        ...base,
        key: `issued:${event.person.accountId}:${event.product.id}:${event.occurredAt}`,
        title: "Выдан доступ",
        detail: overviewOriginLabels[event.origin].toLowerCase(),
        href: null,
      };
    case "access_revoked":
    case "access_restored":
      return {
        ...base,
        key: `${event.kind}:${event.person.accountId}:${event.product.id}:${event.occurredAt}`,
        title:
          event.kind === "access_revoked"
            ? "Доступ отозван"
            : "Доступ восстановлен",
        detail: null,
        href: null,
      };
    case "submission":
      return {
        ...base,
        key: `submission:${event.submissionId}`,
        title: event.commented ? "Сдача с комментарием" : "Новая сдача",
        detail: hasText(event.taskTitle) ? event.taskTitle : null,
        href: internalRoute(
          `/authoring/submissions?submission=${event.submissionId}`,
        ),
      };
  }
}
