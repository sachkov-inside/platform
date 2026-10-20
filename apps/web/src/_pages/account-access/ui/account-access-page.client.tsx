"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { accountPresentationBrowserQueryOptions } from "@/features/account-access";
import {
  acceptedDocumentItems,
  acceptedDocumentsQueryOptions,
  type AcceptedDocumentsPanelProps,
} from "@/features/accepted-documents";

import { AccountEmailPanel } from "@/features/account-email";
import { MemberProfileEditor } from "@/features/member-profile-editor";
import {
  accountPresentationQueryKey,
  type AccountPresentationResult,
} from "@/features/account-access";
import { LearningContinuation } from "@/features/reading-progress";
import { AccountBilling } from "./account-billing.client";

import { AccountAccessView } from "./account-access-view.client";

/** Производственный путь раздела «Аккаунт»: состояние Account и журнал принятия. */
export function AccountAccessPage({
  policies,
}: {
  readonly policies: AcceptedDocumentsPanelProps["policies"];
}) {
  const queryClient = useQueryClient();
  const query = useQuery(accountPresentationBrowserQueryOptions());
  const accepted = useQuery(acceptedDocumentsQueryOptions());
  const presentation =
    query.data?.kind === "ready" ? query.data.presentation : null;

  const showPrivateSections =
    !query.isPending && query.data?.kind !== "unauthorized";

  return (
    <AccountAccessView
      displayName={
        presentation === null
          ? undefined
          : presentation.profile.kind === "profile"
            ? presentation.profile.profile.displayName
            : (presentation.telegramMembership.contact?.displayName ??
              "Участник")
      }
      telegramContact={presentation?.telegramMembership.contact}
      profileSlot={
        presentation === null ? null : (
          <MemberProfileEditor
            initialProfile={
              presentation.profile.kind === "profile"
                ? presentation.profile.profile
                : null
            }
            suggestedName={
              presentation.telegramMembership.contact?.displayName ?? null
            }
            onSaved={(profile) => {
              queryClient.setQueryData<AccountPresentationResult>(
                accountPresentationQueryKey(),
                (current) =>
                  current?.kind === "ready"
                    ? {
                        ...current,
                        presentation: {
                          ...current.presentation,
                          profile: { kind: "profile", profile },
                        },
                      }
                    : current,
              );
            }}
          />
        )
      }
      emailSlot={showPrivateSections ? <AccountEmailPanel /> : null}
      billingSlot={showPrivateSections ? <AccountBilling /> : null}
      continuationSlot={showPrivateSections ? <LearningContinuation /> : null}
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
