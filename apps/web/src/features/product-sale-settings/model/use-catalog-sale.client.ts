"use client";

import { useQuery } from "@tanstack/react-query";

import {
  useOwnerPriceCatalog,
  type ProductSalesState,
} from "@/entities/subscription";

import { readProductSalesStates } from "../api/product-sales-states.browser";
import { useProductSaleAnnouncements } from "./use-product-sale.client";
import {
  catalogPriceReads,
  catalogSalesStatesQueryKey,
  type CatalogSaleReads,
} from "./product-sale";

/** Публичные состояния продажи по продуктам; `null`, когда чтение не удалось. */
export async function readCatalogSalesStates(): Promise<ReadonlyMap<
  string,
  ProductSalesState
> | null> {
  const result = await readProductSalesStates();
  return result.ok
    ? new Map(result.value.map((state) => [state.productId, state]))
    : null;
}

/**
 * Продажи каталога для списка продуктов: два чтения на весь список, а не по запросу на строку.
 * Цены приходят из общего каталога цен владельца (`useOwnerPriceCatalog`), состояния продажи из
 * публичного чтения. Пока хоть одно идёт, вид `loading`; отказ одного из них оставляет известное
 * другим.
 */
export function useCatalogSale():
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly reads: CatalogSaleReads } {
  const prices = useOwnerPriceCatalog();
  useProductSaleAnnouncements();
  const salesStates = useQuery({
    queryKey: catalogSalesStatesQueryKey,
    queryFn: readCatalogSalesStates,
    retry: false,
  });
  if (prices.isPending || salesStates.isPending) return { kind: "loading" };
  return {
    kind: "ready",
    reads: {
      ...(prices.isSuccess ? catalogPriceReads(prices.data) : { prices: null }),
      salesStates: salesStates.data ?? null,
    },
  };
}
