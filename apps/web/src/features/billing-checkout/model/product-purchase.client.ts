"use client";
import { useQuery } from "@tanstack/react-query";
import { restoreProductPurchase } from "../api/billing-checkout.browser";

export function useProductPurchase(
  productId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["account", "product-purchase", productId],
    queryFn: () => restoreProductPurchase(productId ?? ""),
    enabled: enabled && productId !== undefined,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: ({ state }) => {
      const result = state.data;
      if (result === undefined) return false;
      if (!result.ok)
        return result.code === "unauthorized" || result.code === "not_found"
          ? false
          : 3000;
      const purchase = result.value;
      return purchase !== null &&
        purchase.state !== "failed" &&
        (purchase.state !== "confirmed" ||
          purchase.access === "preparing" ||
          purchase.fiscalization === "pending")
        ? 3000
        : false;
    },
  });
}
