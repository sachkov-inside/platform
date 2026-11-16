"use client";
import { hashKey, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import type { FactAnnouncement } from "./fact-announcement";
import { refreshAnnouncedQueries } from "./announced-query-refresh";

/** Keeps queries fresh after an announced change, sharing one read across the document. */
export function useAnnouncedRefresh(
  announcement: Pick<FactAnnouncement, "subscribe"> | null,
  queryKey: QueryKey,
): void {
  const cache = useQueryClient();
  const refresh = useEffectEvent((id: string) => {
    void refreshAnnouncedQueries(cache, queryKey, id);
  });
  const scope = hashKey(queryKey);
  useEffect(() => {
    if (announcement === null) return;
    return announcement.subscribe((id) => {
      refresh(id);
    });
  }, [announcement, cache, scope]);
}
