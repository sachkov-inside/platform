"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

import { refreshAnnouncedQueries } from "@/shared/api/announced-query-refresh";

import { peopleAccessReadsQueryKey } from "@/entities/authoring-person";
import { useAccessChangeRefresh } from "@/features/product-access-actions";

import { personCardQueryOptions } from "../model/person-card-query";
import { AuthoringPersonLoading } from "./authoring-person-loading";
import { AuthoringPersonView } from "./authoring-person-view.client";

export function AuthoringPersonQuery({
  accountId,
}: {
  readonly accountId: string;
}) {
  const client = useQueryClient();
  const card = useQuery(personCardQueryOptions(accountId));
  // Запись доступа в любой вкладке перечитывает карточку и список людей.
  useAccessChangeRefresh(peopleAccessReadsQueryKey);

  if (card.isPending) return <AuthoringPersonLoading />;
  const state = card.data ?? {
    kind: "unavailable" as const,
    reference: "person-card-query",
  };
  return (
    <AuthoringPersonView
      isRefreshing={card.isFetching}
      onRefresh={() => card.refetch()}
      onRetry={() => {
        void card.refetch();
      }}
      onWritten={(announcementId) => {
        void refreshAnnouncedQueries(
          client,
          peopleAccessReadsQueryKey,
          announcementId,
        );
      }}
      state={state}
    />
  );
}
