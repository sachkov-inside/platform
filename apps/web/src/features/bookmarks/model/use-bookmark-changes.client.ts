"use client";
import { useMemo } from "react";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";
import { bookmarkChanges } from "./bookmark-events";

export function useBookmarkChanges(accountId: string | null) {
  const changes = useMemo(
    () => (accountId === null ? null : bookmarkChanges(accountId)),
    [accountId],
  );
  useAnnouncedRefresh(changes, ["bookmarks", accountId]);
}
