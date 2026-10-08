"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import {
  bookmarkStatesQueryOptions,
  setBookmark,
} from "../api/bookmarks.browser";
import { bookmarkChanges } from "../model/bookmark-events";
import { useBookmarkChanges } from "../model/use-bookmark-changes.client";
import type { BookmarkActionView } from "../model/bookmark-action-view";
import { BookmarkAction } from "./bookmark-action.client";

/**
 * Личные закладки спрашивает только вошедший читатель. Аккаунт посетителя оболочка разрешает один
 * раз на страницу и публикует здесь же, откуда его берут отметка о прочтении и сигнал открытия
 * материала, поэтому гость не получает отказ 401 в консоли.
 */
export function SavedBookmarkAction({
  materialId,
}: {
  readonly materialId: string;
}) {
  const { accountId, resolved } = useMaterialReading();
  const queryClient = useQueryClient();
  useBookmarkChanges(resolved ? accountId : null);
  const [notice, setNotice] = useState<"error" | "denied" | null>(null);
  const state = useQuery(
    bookmarkStatesQueryOptions({
      materialId,
      accountId: resolved ? accountId : null,
    }),
  );
  const mutation = useMutation({
    mutationFn: (input: {
      materialId: string;
      bookmarked: boolean;
      accountId: string;
    }) => setBookmark(input),
    onSuccess: async (result, input) => {
      if (result.kind === "unavailable") {
        setNotice("error");
        return;
      }
      if (result.kind === "denied") {
        setNotice("denied");
        return;
      }
      setNotice(null);
      if (result.kind === "ready") bookmarkChanges(input.accountId).announce();
      await queryClient.invalidateQueries(
        { queryKey: ["bookmarks", input.accountId] },
        { cancelRefetch: false },
      );
    },
    onError: () => {
      setNotice("error");
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
  else if (data === undefined)
    view = { kind: "error", bookmarked, desired: !bookmarked };
  else if (data.kind === "unauthorized")
    view = { kind: "anonymous", loginHref: "/account" };
  else if (data.kind !== "ready")
    view = { kind: "error", bookmarked, desired: !bookmarked };
  else if (mutation.isPending)
    view = {
      kind: "pending",
      bookmarked,
      desired: mutation.variables.bookmarked,
    };
  else if (notice === "error")
    view = {
      kind: "error",
      bookmarked,
      desired: mutation.variables?.bookmarked ?? !bookmarked,
    };
  else if (notice === "denied") view = { kind: "denied", bookmarked };
  else view = { kind: "ready", bookmarked };
  return (
    <BookmarkAction
      onToggle={(desired) => {
        if (accountId === null || state.isPending || mutation.isPending) return;
        mutation.mutate({ materialId, bookmarked: desired, accountId });
      }}
      view={view}
    />
  );
}
