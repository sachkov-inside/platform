"use client";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { restoreProductPurchase } from "../api/billing-checkout.browser";

export function useProductPurchase(
  productId: string | undefined,
  enabled: boolean,
  accountId: string | null,
) {
  const purchaseRef = useSearchParams().get("purchaseRef") ?? undefined;
  return useQuery({
    queryKey: [
      "account",
      "product-purchase",
      accountId,
      productId,
      purchaseRef,
    ],
    queryFn: () => restoreProductPurchase(productId ?? "", purchaseRef),
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
