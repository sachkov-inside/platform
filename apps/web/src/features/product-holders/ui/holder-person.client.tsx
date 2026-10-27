"use client";

import { Check, Copy } from "lucide-react";
import type { Route } from "next";
import { useState, type ReactNode } from "react";

import { internalRoute } from "@/shared/routing/internal-route";

/**
 * Человек в строке «Учеников». Имя, @username и email даёт `PersonIdentity` из
 * `@/entities/authoring-person` (#1721, `usePersonIdentities`); пока его нет, строка показывает
 * нейтральную замену: короткий ID аккаунта с копированием и ссылку в карточку человека. Замена на
 * `PersonIdentity` делается только в этом файле: таблица берёт отсюда заголовок и подстроку.
 */
export interface HolderPersonCells {
  /** Текст ссылки строки в карточку человека. */
  readonly title: (accountId: string) => ReactNode;
  /** Подстрока под ним на широком экране. */
  readonly caption: (accountId: string) => ReactNode;
}

export function useHolderPersonCells(
  _accountIds: readonly string[],
): HolderPersonCells {
  return {
    title: (accountId) => (
      <>
        Аккаунт <span className="font-mono">{shortAccountId(accountId)}</span>
      </>
    ),
    caption: (accountId) => <CopyAccountId accountId={accountId} />,
  };
}

export function holderPersonHref(accountId: string): Route {
  return internalRoute(`/authoring/people/${encodeURIComponent(accountId)}`);
}

function shortAccountId(accountId: string): string {
  return accountId.slice(0, 8);
}

function CopyAccountId({ accountId }: { readonly accountId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label={
        copied
          ? "ID аккаунта скопирован"
          : `Скопировать ID аккаунта ${shortAccountId(accountId)}`
      }
      className="admin-text-button inline-flex items-center gap-1.5 px-0 text-xs font-normal text-muted-foreground no-underline"
      onClick={() => {
        void navigator.clipboard.writeText(accountId).then(
          () => {
            setCopied(true);
          },
          () => {
            setCopied(false);
          },
        );
      }}
      type="button"
    >
      {copied ? (
        <Check aria-hidden="true" className="size-3.5" />
      ) : (
        <Copy aria-hidden="true" className="size-3.5" />
      )}
      {copied ? "Скопирован" : "Скопировать ID"}
    </button>
  );
}
