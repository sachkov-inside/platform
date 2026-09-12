"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { bookmarkStatesQueryOptions, setBookmark } from "../api/bookmarks.browser";
import type { BookmarkActionView } from "../model/bookmark-action-view";
import { BookmarkAction } from "./bookmark-action.client";

/**
 * Личные закладки спрашивает только вошедший читатель. Аккаунт посетителя оболочка разрешает один
 * раз на страницу и публикует здесь же, откуда его берут отметка о прочтении и сигнал открытия
 * материала, поэтому гость не получает отказ 401 в консоли.
 */
export function SavedBookmarkAction({ materialId }: { readonly materialId: string }) {
  const { accountId, resolved } = useMaterialReading();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<"error" | "denied" | null>(null);
  const state = useQuery(bookmarkStatesQueryOptions({ materialId, signedIn: resolved && accountId !== null }));
  const mutation = useMutation({
    mutationFn: setBookmark,
    onSuccess: async (result) => {
      if (result.kind === "unavailable") { setNotice("error"); return; }
      if (result.kind === "denied") { setNotice("denied"); return; }
      setNotice(null);
      await queryClient.invalidateQueries({ queryKey: ["bookmarks"] });
    },
    onError: () => { setNotice("error"); },
  });
  const data = state.data;
  const bookmarked = data?.kind === "ready" && data.states[0]?.bookmarked === true;
  let view: BookmarkActionView;
  if (!resolved) view = { kind: "loading" };
  else if (accountId === null) view = { kind: "anonymous", loginHref: "/account" };
  else if (state.isPending) view = { kind: "loading" };
  else if (data === undefined) view = { kind: "error", bookmarked, desired: !bookmarked };
  else if (data.kind === "unauthorized") view = { kind: "anonymous", loginHref: "/account" };
  else if (data.kind !== "ready") view = { kind: "error", bookmarked, desired: !bookmarked };
  else if (mutation.isPending) view = { kind: "pending", bookmarked, desired: mutation.variables?.bookmarked ?? !bookmarked };
  else if (notice === "error") view = { kind: "error", bookmarked, desired: mutation.variables?.bookmarked ?? !bookmarked };
  else if (notice === "denied") view = { kind: "denied", bookmarked };
  else view = { kind: "ready", bookmarked };
  return (
    <BookmarkAction
      onToggle={(desired) => {
        if (state.isPending || mutation.isPending) return;
        mutation.mutate({ materialId, bookmarked: desired });
      }}
      view={view}
    />
  );
}
