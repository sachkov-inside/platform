"use client";
import { useEffect } from "react";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readBillingEndpoint } from "@/entities/subscription";
import { communityEntrySchema } from "./community-entry";

const productCommunityChanged = factAnnouncement(
  "inside.product.community.changed",
);
export const announceProductCommunityChange = productCommunityChanged.announce;

export function useProductCommunityEntry(
  productId: string,
  accountId: string | null,
  enabled: boolean,
) {
  const client = useQueryClient();
  useEffect(
    () =>
      productCommunityChanged.subscribe(() => {
        void client.invalidateQueries({
          queryKey: ["account", "product-community"],
        });
      }),
    [client],
  );
  return useQuery({
    queryKey: ["account", "product-community", accountId, productId],
    queryFn: () =>
      readBillingEndpoint(
        `/api/account/community-entry?productId=${encodeURIComponent(productId)}`,
        communityEntrySchema,
      ),
    enabled,
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: ({ state }) => {
      const result = state.data;
      if (result === undefined) return false;
      if (!result.ok) return result.code === "unauthorized" ? false : 5000;
      return result.value.kind === "preparing" ||
        result.value.kind === "join" ||
        result.value.kind === "link_telegram"
        ? 5000
        : false;
    },
  });
}
