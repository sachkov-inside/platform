"use client";
import { useQuery } from "@tanstack/react-query";

import { accountPresentationBrowserQueryOptions } from "@/features/account-access";
import {
  acceptedDocumentItems,
  acceptedDocumentsQueryOptions,
  type AcceptedDocumentsPanelProps,
} from "@/features/accepted-documents";

import { LearningContinuation } from "@/features/reading-progress";
import { useBillingContact } from "@/features/billing-contact";
import { AccountBilling } from "./account-billing.client";

import { AccountAccessView } from "./account-access-view.client";

/** Производственный путь раздела «Аккаунт»: состояние Account и журнал принятия. */
export function AccountAccessPage({
  policies,
}: {
  readonly policies: AcceptedDocumentsPanelProps["policies"];
}) {
  const query = useQuery(accountPresentationBrowserQueryOptions());
  const contact = useBillingContact({ enabled: query.data?.kind === "ready" });
  const accepted = useQuery(acceptedDocumentsQueryOptions());
  const presentation =
    query.data?.kind === "ready" ? query.data.presentation : null;

  return (
    <AccountAccessView
      billingSlot={query.data?.kind === "ready" ? <AccountBilling /> : null}
      continuationSlot={
        query.data?.kind === "ready" ? <LearningContinuation /> : null
      }
      email={
        query.data?.kind === "ready" && contact.data?.ok === true
          ? contact.data.initialEmail
          : undefined
      }
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
      unavailable={!query.isPending && presentation === null}
    />
  );
}
