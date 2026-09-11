"use client";
import { useQuery } from "@tanstack/react-query";

import { accountPresentationBrowserQueryOptions } from "@/features/account-access";

import { AccountAccessView } from "./account-access-view.client";

/** Производственный путь раздела «Аккаунт»: одно чтение состояния Account. */
export function AccountAccessPage() {
  const query = useQuery(accountPresentationBrowserQueryOptions());
  const presentation =
    query.data?.kind === "ready" ? query.data.presentation : null;

  return (
    <AccountAccessView
      link={presentation?.telegramMembership.link ?? null}
      loading={query.isPending}
      onTelegramRefresh={() => query.refetch().then(() => undefined)}
      sessionExpired={query.data?.kind === "unauthorized"}
      unavailable={query.isError && presentation === null}
    />
  );
}
