"use client";

import type { Route } from "next";
import type { ReactNode } from "react";

import {
  CopyAccountId,
  personRowLabel,
  usePersonIdentities,
} from "@/entities/authoring-person";
import { internalRoute } from "@/shared/routing/internal-route";

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
    title: (accountId) => {
      const label = personRowLabel(identities, accountId);
      return (
        label.title ?? (
          <span className="text-muted-foreground">{label.missing}</span>
        )
      );
    },
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

export function holderPersonHref(accountId: string): Route {
  return internalRoute(`/authoring/people/${encodeURIComponent(accountId)}`);
}
