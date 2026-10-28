import Link from "next/link";
import type { Route } from "next";

import {
  personLabel,
  type PersonIdentity as Identity,
} from "../model/person-identity";
import { CopyAccountId } from "./copy-account-id.client";

export interface PersonIdentityProps {
  readonly accountId: string;
  /** `null`: подписи нет (не человек или чтение не удалось): «Нет данных о человеке» и ID. */
  readonly identity: Identity | null;
  /** Ссылка на карточку человека; заголовок становится ссылкой. */
  readonly href?: Route;
  /** ID с копированием под подписью; в плотной строке таблицы его можно скрыть. */
  readonly showAccountId?: boolean;
}

/**
 * Человек в строке списка или в шапке: имя Telegram, затем @username, затем email (решение 5).
 * Заголовок не бывает UUID: без контактов виден текст «Без имени и email», при непрочитанных
 * фактах «Контакты временно недоступны», а ID стоит мелко ниже.
 */
export function PersonIdentity({
  accountId,
  identity,
  href,
  showAccountId = true,
}: PersonIdentityProps) {
  const label =
    identity === null
      ? { title: null, context: [], missing: "Нет данных о человеке" }
      : personLabel(identity);
  const title = label.title ?? label.missing;
  return (
    <span className="flex min-w-0 flex-col gap-0.5" data-person={accountId}>
      {href === undefined ? (
        <span
          className={`truncate font-medium ${label.title === null ? "text-muted-foreground" : ""}`}
        >
          {title}
        </span>
      ) : (
        <Link
          href={href}
          className={`truncate font-medium underline-offset-2 hover:underline ${label.title === null ? "text-muted-foreground" : ""}`}
        >
          {title}
        </Link>
      )}
      {label.context.length > 0 ? (
        <span className="truncate text-sm text-muted-foreground">
          {label.context.join(" · ")}
        </span>
      ) : null}
      {showAccountId ? <CopyAccountId accountId={accountId} /> : null}
    </span>
  );
}
