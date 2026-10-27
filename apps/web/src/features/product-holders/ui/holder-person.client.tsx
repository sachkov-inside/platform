"use client";

import type { ReactNode } from "react";

import {
  CopyAccountId,
  personRowLabel,
  personRowTitle,
  usePersonIdentities,
} from "@/entities/authoring-person";

/**
 * Человек в строке «Учеников»: имя Telegram, затем @username, затем email (`@/entities/authoring-person`).
 * Подписи всей страницы читаются одним чтением; пока оно идёт, при отказе, сбое или у аккаунта без
 * контактов заголовок нейтральный, а ID стоит мелко в подстроке с копированием.
 */
export interface HolderPersonCells {
  /** Текст ссылки строки в карточку человека. */
  readonly title: (accountId: string) => ReactNode;
  /** Подстрока под ним на широком экране. */
  readonly caption: (accountId: string) => ReactNode;
}

export function useHolderPersonCells(
  accountIds: readonly string[],
): HolderPersonCells {
  const identities = usePersonIdentities(accountIds);
  return {
    title: (accountId) => personRowTitle(identities, accountId),
    caption: (accountId) => {
      const { context } = personRowLabel(identities, accountId);
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          {context.length > 0 ? (
            <span className="truncate">{context.join(" · ")}</span>
          ) : null}
          <CopyAccountId accountId={accountId} />
        </span>
      );
    },
  };
}
