"use client";
import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import {
  billingErrorMessage,
  type BillingFailureCode,
  type PriceSnapshot,
} from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import {
  issueInvitation,
  listInvitations,
  revokeInvitation,
} from "../api/invitations.browser";
import {
  accessSummaryQueryKey,
  invitationsQueryKey,
} from "../model/access-query-keys";
import {
  invitationsPageSize,
  type Invitation,
  type InvitationStateFilter,
} from "../model/invitation-operations";
import {
  InvitationsView,
  type IssueInvitationRequest,
} from "./invitations-view.client";

/** Отказы выдачи и отзыва объясняются словами владельца, а не кодами billing. */
const issueMessages: Partial<Record<BillingFailureCode, string>> = {
  not_found:
    "Предложение не найдено или уже в архиве. Обновите страницу и выберите другое.",
  state_conflict:
    "Для приглашения нужно предложение подписки с составом доступа.",
  invalid_request:
    "Проверьте получателя и предложение. Заметка — до 200 символов.",
};
const revokeMessages: Partial<Record<BillingFailureCode, string>> = {
  state_conflict:
    "Это приглашение уже использовано или сгорело: отозвать его нельзя. Список обновлён.",
  revision_conflict:
    "Приглашение изменилось, пока был открыт список. Список обновлён — проверьте его и повторите.",
};

export function InvitationsPanel({
  offers,
}: {
  readonly offers: readonly PriceSnapshot[];
}) {
  const cache = useQueryClient();
  const { operationId, completeOperation } = useRepeatableOperations();
  const [filter, setFilter] = useState<InvitationStateFilter>("all");
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [issued, setIssued] = useState<Invitation | null>(null);
  const list = useInfiniteQuery({
    queryKey: [...invitationsQueryKey, filter],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      // Чтение ничего не меняет: каждой странице своя ссылка на операцию.
      const result = await listInvitations({
        operationId: crypto.randomUUID(),
        limit: invitationsPageSize,
        ...(filter === "all" ? {} : { state: filter }),
        ...(pageParam === null ? {} : { cursor: pageParam }),
      });
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value.result;
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  function refresh() {
    void cache.invalidateQueries({ queryKey: invitationsQueryKey });
    void cache.invalidateQueries({ queryKey: accessSummaryQueryKey });
  }
  function lost() {
    setFailure(
      "Ответ не получен. Повторите то же действие: повтор не создаст второе приглашение.",
    );
  }
  const issuing = useMutation({
    mutationFn: issueInvitation,
    onError: lost,
    onSuccess: (result) => {
      if (!result.ok) {
        setFailure(
          issueMessages[result.code] ?? billingErrorMessage(result.code),
        );
        return;
      }
      completeOperation("issue");
      setFailure(null);
      setMessage("");
      setIssued(result.value.result.value);
      refresh();
    },
  });
  const revoking = useMutation({
    mutationFn: revokeInvitation,
    onError: lost,
    onSuccess: (result, input) => {
      if (!result.ok) {
        setMessage("");
        setFailure(
          revokeMessages[result.code] ?? billingErrorMessage(result.code),
        );
        // Отказ по состоянию или ревизии значит, что список устарел.
        if (
          result.code === "state_conflict" ||
          result.code === "revision_conflict"
        ) {
          completeOperation(`revoke:${input.invitationId}`);
          refresh();
        }
        return;
      }
      completeOperation(`revoke:${input.invitationId}`);
      setFailure(null);
      setMessage("Приглашение отозвано.");
      refresh();
    },
  });
  return (
    <InvitationsView
      busy={issuing.isPending || revoking.isPending}
      error={list.error?.message ?? null}
      failure={failure}
      filter={filter}
      hasMore={list.hasNextPage}
      invitations={list.data?.pages.flatMap((page) => page.items) ?? []}
      issued={issued}
      loading={list.isPending}
      loadingMore={list.isFetchingNextPage}
      message={message}
      offers={offers}
      onCopy={(text) => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setMessage("Скопировано.");
          },
          () => {
            setMessage("Скопируйте ссылку вручную.");
          },
        );
      }}
      onFilterChange={setFilter}
      onIssue={(request: IssueInvitationRequest) => {
        issuing.mutate({
          operationId: operationId("issue", request),
          ...request,
        });
      }}
      onLoadMore={() => {
        void list.fetchNextPage();
      }}
      onRevoke={(invitation) => {
        const target = {
          invitationId: invitation.id,
          expectedRevision: invitation.revision,
        };
        revoking.mutate({
          operationId: operationId(`revoke:${invitation.id}`, target),
          ...target,
        });
      }}
    />
  );
}
