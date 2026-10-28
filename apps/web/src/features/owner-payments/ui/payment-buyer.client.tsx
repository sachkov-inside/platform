"use client";

import Link from "next/link";

import {
  CopyAccountId,
  PersonIdentity,
  personRowLabel,
  usePersonIdentities,
} from "@/entities/authoring-person";
import { authoringPersonHref } from "@/shared/routing/authoring";

/** Покупатель на странице платежа: подпись со ссылкой в карточку человека и ID с копированием. */
export function PaymentBuyer({ accountId }: { readonly accountId: string }) {
  const identities = usePersonIdentities([accountId]);
  const href = authoringPersonHref(accountId);
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
