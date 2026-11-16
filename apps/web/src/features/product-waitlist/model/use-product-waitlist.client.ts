"use client";
import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import { refreshAnnouncedQueries } from "@/shared/api/announced-query-refresh";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";
import { readWaitlist } from "../api/product-waitlist.browser";
export const productWaitlistKey = (
  accountId: string | null,
  productId: string,
) => ["product-waitlist", accountId, productId] as const;
export const productWaitlistChanges = (accountId: string, productId: string) =>
  factAnnouncement(`inside.product-waitlist.${accountId}.${productId}.changed`);
export function refreshProductWaitlist(
  cache: QueryClient,
  accountId: string,
  productId: string,
  id: string,
): Promise<void> {
  return refreshAnnouncedQueries(
    cache,
    productWaitlistKey(accountId, productId),
    id,
  );
}
/** One Account-scoped fact and shared announcement transport, including same-document fallback. */
export function useProductWaitlist(productId: string) {
  const { accountId, resolved } = useMaterialReading();
  const query = useQuery({
    queryKey: productWaitlistKey(accountId, productId),
    queryFn: ({ signal }) => readWaitlist(productId, accountId, signal),
    enabled: resolved && accountId !== null,
    retry: false,
  });
  const changes = useMemo(
    () =>
      accountId === null || !resolved
        ? null
        : productWaitlistChanges(accountId, productId),
    [accountId, productId, resolved],
  );
  useAnnouncedRefresh(changes, productWaitlistKey(accountId, productId));
  return { query, accountId, resolved };
}
