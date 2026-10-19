"use client";
import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useMaterialReading } from "@/entities/material";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import { readWaitlist } from "../api/product-waitlist.browser";
export const productWaitlistKey = (
  accountId: string | null,
  productId: string,
) => ["product-waitlist", accountId, productId] as const;
export const productWaitlistChanges = (accountId: string, productId: string) =>
  factAnnouncement(`inside.product-waitlist.${accountId}.${productId}.changed`);
const refreshes = new WeakMap<
  QueryClient,
  Map<string, { id: string; pending: Promise<void> }>
>();
export function refreshProductWaitlist(
  cache: QueryClient,
  accountId: string,
  productId: string,
  id: string,
): Promise<void> {
  let requests = refreshes.get(cache);
  if (requests === undefined) {
    requests = new Map();
    refreshes.set(cache, requests);
  }
  const scope = `${accountId}:${productId}`;
  const previous = requests.get(scope);
  if (previous?.id === id) return previous.pending;
  const queryKey = productWaitlistKey(accountId, productId);
  const pending = cache
    .cancelQueries({ queryKey })
    .then(() =>
      cache.invalidateQueries({ queryKey }, { cancelRefetch: false }),
    );
  requests.set(scope, { id, pending });
  return pending;
}
/** One Account-scoped fact and shared announcement transport, including same-document fallback. */
export function useProductWaitlist(productId: string) {
  const { accountId, resolved } = useMaterialReading();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: productWaitlistKey(accountId, productId),
    queryFn: ({ signal }) => readWaitlist(productId, accountId, signal),
    enabled: resolved && accountId !== null,
    retry: false,
  });
  useEffect(() => {
    if (accountId === null || !resolved) return;
    return productWaitlistChanges(accountId, productId).subscribe((id) => {
      void refreshProductWaitlist(cache, accountId, productId, id);
    });
  }, [accountId, cache, productId, resolved]);
  return { query, accountId, resolved };
}
