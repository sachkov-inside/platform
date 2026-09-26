"use client";
import { useQuery } from "@tanstack/react-query";

import { accountPresentationBrowserQueryOptions } from "@/features/account-access";
import {
  acceptedDocumentItems,
  acceptedDocumentsQueryOptions,
  type AcceptedDocumentsPanelProps,
} from "@/features/accepted-documents";

import { AccountAccessView } from "./account-access-view.client";

/** Производственный путь раздела «Аккаунт»: состояние Account и журнал принятия. */
export function AccountAccessPage({
  policies,
}: {
  readonly policies: AcceptedDocumentsPanelProps["policies"];
}) {
  const query = useQuery(accountPresentationBrowserQueryOptions());
  const accepted = useQuery(acceptedDocumentsQueryOptions());
  const presentation =
    query.data?.kind === "ready" ? query.data.presentation : null;

  return (
    <AccountAccessView
      acceptedDocuments={{
        policies,
        state:
          accepted.data === undefined
            ? { kind: "loading" }
            : accepted.data.kind === "ready"
              ? {
                  kind: "ready",
                  items: acceptedDocumentItems(accepted.data.documents),
                }
              : { kind: "unavailable" },
      }}
      link={presentation?.telegramMembership.link ?? null}
      loading={query.isPending}
      onTelegramRefresh={() => query.refetch().then(() => undefined)}
      sessionExpired={query.data?.kind === "unauthorized"}
      unavailable={query.isError && presentation === null}
    />
  );
}
