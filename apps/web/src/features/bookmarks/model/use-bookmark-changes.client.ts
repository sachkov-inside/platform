"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bookmarkChanges, refreshBookmarks } from "./bookmark-events";

export function useBookmarkChanges(accountId: string | null) {
  const cache = useQueryClient();
  useEffect(() => {
    if (accountId === null) return;
    return bookmarkChanges(accountId).subscribe((announcementId) => {
      void refreshBookmarks(cache, accountId, announcementId);
    });
  }, [accountId, cache]);
}
