"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

import {
  BillingReadError,
  ownerPriceCatalogChanged,
  paymentLinksQueryKey,
} from "@/entities/subscription";
import { refreshAnnouncedQueries } from "@/shared/api/announced-query-refresh";
import { useAnnouncedRefresh } from "@/shared/api/use-announced-refresh.client";

import { listPaymentLinks } from "../api/payment-links.browser";
import { paymentLinksChanged } from "./payment-link-events";
import type { PaymentLinksFilter } from "./payment-links-presentation";

const pageSize = 30;

/** The link lists share one post-write read, including writes to their product price. */
export function usePaymentLinks(filter: PaymentLinksFilter) {
  const cache = useQueryClient();
  useAnnouncedRefresh(paymentLinksChanged, paymentLinksQueryKey);
  // Archived prices close their links; an older in-flight list cannot answer that write (#2392).
  useAnnouncedRefresh(ownerPriceCatalogChanged, paymentLinksQueryKey);

  const list = useInfiniteQuery({
    queryKey: [...paymentLinksQueryKey, filter.productId, filter.state],
    // Refusal/unavailability remains visible with an explicit retry.
    retry: false,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const result = await listPaymentLinks({
        operationId: crypto.randomUUID(),
        limit: pageSize,
        ...(filter.productId === null ? {} : { productId: filter.productId }),
        ...(filter.state === null ? {} : { state: filter.state }),
        ...(pageParam === null ? {} : { cursor: pageParam }),
      });
      if (!result.ok) throw new BillingReadError(result.code);
      return result.value.result;
    },
    getNextPageParam: (page) => page.nextCursor,
  });

  const refresh = () => {
    void cache.invalidateQueries({ queryKey: paymentLinksQueryKey });
  };
  const written = () => {
    const id = paymentLinksChanged.announce();
    void refreshAnnouncedQueries(cache, paymentLinksQueryKey, id);
  };
  return { list, refresh, written };
}
