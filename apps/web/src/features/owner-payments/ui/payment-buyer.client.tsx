"use client";

import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  CopyAccountId,
  PersonIdentity,
  personRowLabel,
  usePersonIdentities,
} from "@/entities/authoring-person";
import { internalRoute } from "@/shared/routing/internal-route";

/**
 * Покупатель платежа: имя Telegram, затем @username, затем email (`@/entities/authoring-person`).
 * Подписи страницы списка читаются одним чтением; пока оно идёт, при отказе, сбое или у аккаунта
 * без контактов вместо имени стоит нейтральный текст, а не номер аккаунта.
 */
export function usePaymentBuyerTitles(
  accountIds: readonly string[],
): (accountId: string) => ReactNode {
  const identities = usePersonIdentities(accountIds);
  return (accountId) => {
    const label = personRowLabel(identities, accountId);
    return (
      label.title ?? (
        <span className="text-muted-foreground">{label.missing}</span>
      )
    );
  };
}

/** Покупатель на странице платежа: подпись со ссылкой в карточку человека и ID с копированием. */
export function PaymentBuyer({ accountId }: { readonly accountId: string }) {
  const identities = usePersonIdentities([accountId]);
  const href = buyerHref(accountId);
  const identity =
    identities.kind === "ready"
      ? identities.byId.get(accountId.toLowerCase())
      : undefined;
  if (identity !== undefined)
    return (
      <PersonIdentity accountId={accountId} href={href} identity={identity} />
    );
  const label = personRowLabel(identities, accountId);
  return (
    <span className="flex min-w-0 flex-col gap-0.5" data-person={accountId}>
      <Link
        className="truncate font-medium text-muted-foreground underline-offset-2 hover:underline"
        href={href}
      >
        {label.missing}
      </Link>
      <CopyAccountId accountId={accountId} />
    </span>
  );
}

function buyerHref(accountId: string): Route {
  return internalRoute(`/authoring/people/${encodeURIComponent(accountId)}`);
}
