"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bookmarkChanges } from "./bookmark-events";

export function useBookmarkChanges(accountId: string | null) {
  const cache = useQueryClient();
  useEffect(() => {
    if (accountId === null) return;
    return bookmarkChanges(accountId).subscribe(() => {
      void cache.invalidateQueries(
        { queryKey: ["bookmarks", accountId] },
        { cancelRefetch: false },
      );
    });
  }, [accountId, cache]);
}
