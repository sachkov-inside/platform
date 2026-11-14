"use client";

import {
  hashKey,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { FactAnnouncement } from "./fact-announcement";

const refreshes = new WeakMap<
  QueryClient,
  Map<string, { readonly id: string; readonly pending: Promise<void> }>
>();

/**
 * Re-reads the queries under `queryKey` once per announced write: a read started before the write
 * is cancelled, and every surface of this document that heard the same announcement joins the one
 * read after it.
 */
export function refreshAnnouncedQueries(
  cache: QueryClient,
  queryKey: QueryKey,
  announcementId: string,
): Promise<void> {
  let byKey = refreshes.get(cache);
  if (byKey === undefined) {
    byKey = new Map();
    refreshes.set(cache, byKey);
  }
  const scope = hashKey(queryKey);
  const previous = byKey.get(scope);
  if (previous?.id === announcementId) return previous.pending;
  const pending = cache
    .cancelQueries({ queryKey })
    .then(() =>
      cache.invalidateQueries({ queryKey }, { cancelRefetch: false }),
    );
  byKey.set(scope, { id: announcementId, pending });
  return pending;
}

/**
 * Keeps the queries under `queryKey` fresh after writes another surface of this browser announces.
 * Without an announcement (a guest, or the reader not known yet) nothing is subscribed. The caller
 * keeps `announcement` stable, for example with `useMemo` over the Account.
 */
export function useAnnouncedRefresh(
  announcement: FactAnnouncement | null,
  queryKey: QueryKey,
): void {
  const cache = useQueryClient();
  const latestKey = useRef(queryKey);
  useEffect(() => {
    latestKey.current = queryKey;
  });
  // The key array is new on every render; its hash says when the subscription must change.
  const scope = hashKey(queryKey);
  useEffect(() => {
    if (announcement === null) return;
    return announcement.subscribe((id) => {
      void refreshAnnouncedQueries(cache, latestKey.current, id);
    });
  }, [announcement, cache, scope]);
}
