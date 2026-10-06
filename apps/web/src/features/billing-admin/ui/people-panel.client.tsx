"use client";
import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  announceEnrollmentChange,
  billingErrorMessage,
  type BillingCommandResult,
  type BillingFailureCode,
  type PriceSnapshot,
} from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import { listPeople } from "../api/access.browser";
import {
  extendAccessGrant,
  revokeAccessGrant,
} from "../api/billing-admin.browser";
import {
  assignSubscriptionEnrollment,
  changeSubscriptionEnrollment,
  listSubscriptionTiers,
} from "../api/enrollments.browser";
import { issueInvitation } from "../api/invitations.browser";
import {
  endOfMoscowDay,
  noPeopleFilters,
  peoplePageSize,
  type PeopleFilters,
} from "../model/access-operations";
import {
  accessSummaryQueryKey,
  invitationsQueryKey,
  peopleQueryKey,
} from "../model/access-query-keys";
import {
  invitationOfferNames,
  type Invitation,
} from "../model/invitation-operations";
import {
  PeopleView,
  type AssignRequest,
  type GiftRequest,
  type GroundChangeRequest,
} from "./people-view.client";

const changeMessages: Partial<Record<BillingFailureCode, string>> = {
  revision_conflict:
    "Доступ изменился, пока была открыта карточка. Список обновлён — проверьте и повторите.",
  invalid_request:
    "Проверьте срок и причину: конец доступа должен быть позже его начала.",
  not_found:
    "Тариф недоступен для назначения или основание не найдено. Список обновлён.",
  state_conflict:
    "Этот тариф нельзя назначить: у него нет состава доступа или он не открыт для назначения.",
};

interface AccessChange {
  readonly slot: string;
  readonly message: string;
  readonly run: () => Promise<BillingCommandResult<unknown>>;
}

export function PeoplePanel({
  offers,
}: {
  readonly offers: readonly PriceSnapshot[];
}) {
  const cache = useQueryClient();
  const { operationId, completeOperation } = useRepeatableOperations();
  // Начало назначения читается при первой отправке и не меняется у повтора той же операции.
  const assignmentStarts = useRef(new Map<string, string>());
  const [filters, setFilters] = useState<PeopleFilters>(noPeopleFilters);
  const [message, setMessage] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [gift, setGift] = useState<{
    accountId: string;
    invitation: Invitation;
  } | null>(null);
  const people = useInfiniteQuery({
    queryKey: [...peopleQueryKey, filters],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listPeople({
        operationId: crypto.randomUUID(),
        limit: peoplePageSize,
        ...(filters.offerId === null ? {} : { offerId: filters.offerId }),
        ...(filters.source === null ? {} : { source: filters.source }),
        ...(filters.state === null ? {} : { state: filters.state }),
        ...(pageParam === null ? {} : { cursor: pageParam }),
      });
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value.result;
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const tiers = useQuery({
    queryKey: ["owner-subscription-tiers"],
    queryFn: async () => {
      const result = await listSubscriptionTiers({
        operationId: crypto.randomUUID(),
        limit: 100,
      });
      if (!result.ok) throw new Error(billingErrorMessage(result.code));
      return result.value.result.items;
    },
  });
  const assignable = (tiers.data ?? []).filter(
    (row) => row.availableForAssignment && !row.archived,
  );
  function refresh() {
    void cache.invalidateQueries({ queryKey: peopleQueryKey });
    void cache.invalidateQueries({ queryKey: accessSummaryQueryKey });
  }
  const change = useMutation({
    retry: false,
    mutationFn: async (task: AccessChange) => ({
      task,
      result: await task.run(),
    }),
    onError: () => {
      setFailure(
        "Ответ не получен. Повторите то же действие: повтор не изменит доступ второй раз.",
      );
    },
    onSuccess: ({ task, result }) => {
      if (!result.ok) {
        setMessage("");
        setFailure(
          changeMessages[result.code] ?? billingErrorMessage(result.code),
        );
        if (result.code === "revision_conflict") {
          completeOperation(task.slot);
          refresh();
        }
        return;
      }
      completeOperation(task.slot);
      assignmentStarts.current.clear();
      announceEnrollmentChange();
      setFailure(null);
      setMessage(task.message);
      refresh();
    },
  });
  const giving = useMutation({
    mutationFn: (task: {
      readonly accountId: string;
      readonly input: Parameters<typeof issueInvitation>[0];
    }) => issueInvitation(task.input),
    onError: () => {
      setFailure(
        "Ответ не получен. Повторите то же действие: повтор не создаст второе приглашение.",
      );
    },
    onSuccess: (result, { accountId }) => {
      if (!result.ok) {
        setMessage("");
        setFailure(
          result.code === "state_conflict"
            ? "Этот тариф не открыт для назначения: подарить его нельзя."
            : billingErrorMessage(result.code),
        );
        return;
      }
      completeOperation(`gift:${accountId}`);
      setFailure(null);
      setMessage("Подарочное приглашение готово.");
      setGift({ accountId, invitation: result.value.result.value });
      void cache.invalidateQueries({ queryKey: invitationsQueryKey });
      void cache.invalidateQueries({ queryKey: accessSummaryQueryKey });
    },
  });

  function changeGround(request: GroundChangeRequest) {
    const { ground, action, reason } = request;
    const endsAt =
      action === "extend"
        ? request.until === null
          ? null
          : endOfMoscowDay(request.until)
        : ground.endsAt;
    const slot = `ground:${ground.id}`;
    const message =
      action === "extend"
        ? "Срок изменён."
        : action === "revoke"
          ? "Доступ отозван. Остальные основания человека сохранены."
          : "Доступ восстановлен.";
    if (ground.kind === "enrollment") {
      const command = {
        enrollmentId: ground.id,
        expectedRevision: ground.revision,
        action: action === "extend" ? ("change_term" as const) : action,
        terms: {
          startsAt: ground.startsAt,
          endsAt,
          endPolicy: ground.endPolicy ?? "fixed",
        },
        reason,
      };
      change.mutate({
        slot,
        message,
        run: () =>
          changeSubscriptionEnrollment({
            ...command,
            operationId: operationId(slot, command),
          }),
      });
      return;
    }
    if (action === "revoke") {
      const command = {
        grantRef: ground.id,
        expectedRevision: ground.revision,
        reason,
      };
      change.mutate({
        slot,
        message,
        run: () =>
          revokeAccessGrant({
            ...command,
            operationId: operationId(slot, command),
          }),
      });
      return;
    }
    const command = {
      grantRef: ground.id,
      expectedRevision: ground.revision,
      reason,
      validUntil: endsAt,
    };
    change.mutate({
      slot,
      message,
      run: () =>
        extendAccessGrant({
          ...command,
          operationId: operationId(slot, command),
        }),
    });
  }

  function assign(request: AssignRequest) {
    const tier = assignable.find((row) => row.tier.id === request.offerId);
    if (tier === undefined) {
      setFailure("Выберите тариф, открытый для назначения.");
      return;
    }
    const slot = `assign:${request.accountId}`;
    const id = operationId(slot, request);
    change.mutate({
      slot,
      message: "Тариф назначен. Платёж и списания не создавались.",
      run: () => {
        const startsAt =
          assignmentStarts.current.get(id) ?? new Date().toISOString();
        assignmentStarts.current.set(id, startsAt);
        return assignSubscriptionEnrollment({
          operationId: id,
          accountId: request.accountId,
          origin: "manual",
          // Повтор той же операции называет тот же источник: второе назначение не появится.
          sourceRef: `owner-assignment:${id}`,
          tierId: tier.tier.id,
          tierRevision: tier.tier.revision,
          terms: {
            startsAt,
            endsAt:
              request.until === null ? null : endOfMoscowDay(request.until),
            endPolicy: "fixed",
          },
          billingRef: null,
          reason: request.reason,
        });
      },
    });
  }

  function giveGift(request: GiftRequest) {
    const input = {
      offerId: request.offerId,
      mode: "gift" as const,
      giftMonths: request.giftMonths,
      note: request.note,
    };
    giving.mutate({
      accountId: request.accountId,
      // Слот и нагрузка называют человека: потерянный ответ для одного не отдаётся другому.
      input: {
        operationId: operationId(`gift:${request.accountId}`, {
          ...input,
          accountId: request.accountId,
        }),
        ...input,
      },
    });
  }

  return (
    <PeopleView
      assignable={assignable.map((row) => ({
        id: row.tier.id,
        name: row.tier.name,
      }))}
      busy={change.isPending || giving.isPending}
      error={people.error?.message ?? tiers.error?.message ?? null}
      failure={failure}
      filters={filters}
      gift={gift}
      hasMore={people.hasNextPage}
      loading={people.isPending}
      loadingMore={people.isFetchingNextPage}
      message={message}
      offers={[...invitationOfferNames(offers)].map(([id, name]) => ({
        id,
        name,
      }))}
      onAssign={assign}
      onChangeGround={changeGround}
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
      onFiltersChange={setFilters}
      onGift={giveGift}
      onLoadMore={() => {
        void people.fetchNextPage();
      }}
      people={people.data?.pages.flatMap((page) => page.items) ?? []}
    />
  );
}
