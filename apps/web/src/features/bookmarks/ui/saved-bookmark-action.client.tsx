"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getBookmarkStates, setBookmark } from "../api/bookmarks.browser";
import type { BookmarkActionView } from "../model/bookmark-action-view";
import { BookmarkAction } from "./bookmark-action.client";

export function SavedBookmarkAction({ materialId }: { readonly materialId: string }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<"error" | "denied" | null>(null);
  const state = useQuery({
    queryKey: ["bookmarks", "states", materialId],
    queryFn: () => getBookmarkStates([materialId]),
    retry: false,
    staleTime: 0,
  });
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
  if (state.isPending) view = { kind: "loading" };
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
