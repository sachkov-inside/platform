import { queryOptions } from "@tanstack/react-query";
import * as api from "../api/broadcasts.browser";
const COMMUNICATIONS_POLL_INTERVAL_MS = 10_000;
export const communicationsQueries = {
  posts: (cursor?: string) =>
    queryOptions({
      queryKey: ["communications", "posts", cursor],
      queryFn: () => api.readSavedPosts(cursor),
    }),
  broadcasts: (cursor?: string) =>
    queryOptions({
      queryKey: ["communications", "broadcasts-view", "broadcasts", cursor],
      queryFn: () => api.readBroadcasts(cursor),
    }),
  funnels: (cursor?: string) =>
    queryOptions({
      queryKey: ["communications", "broadcasts-view", "funnels", cursor],
      queryFn: () => api.readFunnels(cursor),
    }),
  statistics: (
    scope: { broadcastId?: string; funnelId?: string },
    cursor?: string,
  ) =>
    queryOptions({
      queryKey: [
        "communications",
        "broadcasts-view",
        "statistics",
        scope,
        cursor,
      ],
      queryFn: () =>
        api.readStatistics({ ...scope, ...(cursor ? { cursor } : {}) }),
      refetchInterval: COMMUNICATIONS_POLL_INTERVAL_MS,
    }),
  deliveries: (
    scope: { broadcastId?: string; funnelId?: string },
    cursor?: string,
  ) =>
    queryOptions({
      queryKey: [
        "communications",
        "broadcasts-view",
        "deliveries",
        scope,
        cursor,
      ],
      queryFn: () =>
        api.readDeliveries({ ...scope, ...(cursor ? { cursor } : {}) }),
      refetchInterval: COMMUNICATIONS_POLL_INTERVAL_MS,
    }),
  entries: (contactId: string | undefined, cursor?: string) =>
    queryOptions({
      queryKey: [
        "communications",
        "broadcasts-view",
        "entries",
        contactId,
        cursor,
      ],
      queryFn: () => api.readEntries(contactId ?? "", cursor),
      enabled: contactId !== undefined,
    }),
};
