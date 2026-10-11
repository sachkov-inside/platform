"use client";

import {
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import {
  bookmarkStatesQueryOptions,
  setBookmark,
} from "../api/bookmarks.browser";
import { bookmarkChanges, refreshBookmarks } from "../model/bookmark-events";
import { useBookmarkChanges } from "../model/use-bookmark-changes.client";
import {
  bookmarkCommandSchema,
  bookmarkStateResultSchema,
} from "../model/bookmark-contract";
import type { BookmarkActionView } from "../model/bookmark-action-view";
import { BookmarkAction } from "./bookmark-action.client";

/**
 * Личные закладки спрашивает только вошедший читатель. Аккаунт посетителя оболочка разрешает один
 * раз на страницу и публикует здесь же, откуда его берут отметка о прочтении и сигнал открытия
 * материала, поэтому гость не получает отказ 401 в консоли.
 */
export function SavedBookmarkAction({
  materialId,
  compact = false,
}: {
  readonly materialId: string;
  readonly compact?: boolean;
}) {
  const { accountId, resolved } = useMaterialReading();
  const queryClient = useQueryClient();
  const mutationKey = [
    "bookmarks",
    accountId,
    "set-state",
    materialId,
  ] as const;
  const saving = useIsMutating({ mutationKey }) > 0;
  useBookmarkChanges(resolved ? accountId : null);
  const latest = useMutationState({
    filters: { mutationKey, exact: true },
    select: ({ state }) => ({
      status: state.status,
      result: bookmarkStateResultSchema.safeParse(state.data).data,
      command: bookmarkCommandSchema.strip().safeParse(state.variables).data,
    }),
  }).at(-1);
  const notice =
    latest?.result?.kind === "denied"
      ? "denied"
      : latest?.status === "error" ||
          (latest?.status === "success" && latest.result?.kind !== "ready")
        ? "error"
        : null;
  const state = useQuery(
    bookmarkStatesQueryOptions({
      materialId,
      accountId: resolved ? accountId : null,
    }),
  );
  const mutation = useMutation({
    mutationKey,
    mutationFn: (input: {
      materialId: string;
      bookmarked: boolean;
      accountId: string;
    }) => setBookmark(input),
    onSuccess: async (result, input) => {
      if (result.kind === "unavailable" || result.kind === "denied") return;
      if (result.kind === "ready") {
        const announcementId = bookmarkChanges(input.accountId).announce();
        await refreshBookmarks(queryClient, input.accountId, announcementId);
      } else {
        await queryClient.invalidateQueries({
          queryKey: ["bookmarks", input.accountId],
        });
      }
    },
  });
  const data = state.data;
  const bookmarked =
    data?.kind === "ready" && data.states[0]?.bookmarked === true;
  let view: BookmarkActionView;
  if (!resolved) view = { kind: "loading" };
  else if (accountId === null)
    view = { kind: "anonymous", loginHref: "/account" };
  else if (state.isPending) view = { kind: "loading" };
  else if (data === undefined) view = { kind: "load-error" };
  else if (data.kind === "unauthorized")
    view = { kind: "anonymous", loginHref: "/account" };
  else if (data.kind !== "ready") view = { kind: "load-error" };
  else if (saving)
    view = {
      kind: "pending",
      bookmarked,
      desired: latest?.command?.bookmarked ?? !bookmarked,
    };
  else if (notice === "error")
    view = {
      kind: "error",
      bookmarked,
      desired: latest?.command?.bookmarked ?? !bookmarked,
    };
  else if (notice === "denied") view = { kind: "denied", bookmarked };
  else view = { kind: "ready", bookmarked };
  return (
    <BookmarkAction
      compact={compact}
      onToggle={(desired) => {
        if (accountId === null || state.isPending || saving) return;
        if (data?.kind !== "ready") {
          void state.refetch();
          return;
        }
        mutation.mutate({ materialId, bookmarked: desired, accountId });
      }}
      view={view}
    />
  );
}
