"use client";

import { useMemo, type ReactNode } from "react";

import { personRowLabel } from "../model/person-row-label";
import {
  usePersonIdentities,
  type PersonIdentitiesView,
} from "../model/use-people-reads.client";

/**
 * Заголовок человека в строке чужого списка (ученики продукта, платежи): имя Telegram, затем
 * @username, затем email. Пока подписи читаются, при отказе, сбое или у аккаунта без контактов
 * заголовок нейтральный, а не номер аккаунта.
 */
export function personRowTitle(
  identities: PersonIdentitiesView,
  accountId: string,
): ReactNode {
  const label = personRowLabel(identities, accountId);
  return (
    label.title ?? (
      <span className="text-muted-foreground">{label.missing}</span>
    )
  );
}

/** Заголовки людей всей страницы списка по одному чтению подписей. */
export function usePersonTitles(
  accountIds: readonly string[],
): (accountId: string) => ReactNode {
  const identities = usePersonIdentities(accountIds);
  return (accountId) => personRowTitle(identities, accountId);
}

/**
 * Заголовок одного человека текстом, например для плашки фильтра. `null`, пока подпись читается,
 * недоступна, у аккаунта нет контактов или человек не выбран.
 */
export function usePersonTitleText(
  accountId: string | undefined,
): string | null {
  const accountIds = useMemo(
    () => (accountId === undefined ? [] : [accountId]),
    [accountId],
  );
  const identities = usePersonIdentities(accountIds);
  return accountId === undefined
    ? null
    : personRowLabel(identities, accountId).title;
}
