"use client";

import { useQuery } from "@tanstack/react-query";

import type { PriceSnapshot, ProductSalesState } from "@/entities/subscription";

import { listOwnerProductPricesOperation } from "../api/list-owner-product-prices.operation";
import { listProductSalesStatesOperation } from "../api/list-product-sales-states.operation";
import {
  CATALOG_SALE_PAGES_LIMIT,
  catalogSaleQueryKey,
  ownerPricesByProduct,
  type CatalogSaleReads,
  type OwnerProductPrice,
} from "./product-sale";

/**
 * Все страницы одного чтения каталога по курсору. Обычный каталог помещается в одну страницу;
 * слишком длинный читается как недоступный, а не обрезается молча.
 */
async function readAllPages<Item>(
  readPage: (cursor: string | undefined) => Promise<{
    readonly items: readonly Item[];
    readonly nextCursor: string | null;
  } | null>,
): Promise<Item[] | null> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < CATALOG_SALE_PAGES_LIMIT; page += 1) {
    const result = await readPage(cursor);
    if (result === null) return null;
    items.push(...result.items);
    if (result.nextCursor === null) return items;
    cursor = result.nextCursor;
  }
  return null;
}

/**
 * Цены владельца по продуктам и продукты с ценой в архиве; `null`, когда права нет или чтение не
 * удалось.
 */
export async function readCatalogPrices(): Promise<{
  readonly prices: ReadonlyMap<string, OwnerProductPrice>;
  readonly archived: ReadonlySet<string>;
} | null> {
  const archived = new Set<string>();
  const items = await readAllPages<PriceSnapshot>(async (cursor) => {
    const result = await listOwnerProductPricesOperation.send({
      operationId: crypto.randomUUID(),
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!result.ok) return null;
    for (const id of result.value.result.archivedProductIds) archived.add(id);
    return result.value.result;
  });
  return items === null
    ? null
    : { prices: ownerPricesByProduct(items), archived };
}

/** Публичные состояния продажи по продуктам; `null`, когда чтение не удалось. */
export async function readCatalogSalesStates(): Promise<ReadonlyMap<
  string,
  ProductSalesState
> | null> {
  const items = await readAllPages<ProductSalesState>(async (cursor) => {
    const result = await listProductSalesStatesOperation.send(
      cursor === undefined ? {} : { cursor },
    );
    return result.ok ? result.value : null;
  });
  return items === null
    ? null
    : new Map(items.map((state) => [state.productId, state]));
}

/**
 * Продажи каталога для списка продуктов: два чтения на весь список, а не по запросу на строку.
 * Пока хоть одно идёт, вид `loading`; отказ одного из них оставляет известное другим.
 */
export function useCatalogSale():
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly reads: CatalogSaleReads } {
  const prices = useQuery({
    queryKey: catalogSaleQueryKey("prices"),
    queryFn: readCatalogPrices,
    retry: false,
  });
  const salesStates = useQuery({
    queryKey: catalogSaleQueryKey("states"),
    queryFn: readCatalogSalesStates,
    retry: false,
  });
  if (prices.isPending || salesStates.isPending) return { kind: "loading" };
  return {
    kind: "ready",
    reads: {
      prices: prices.data?.prices ?? null,
      ...(prices.data == null ? {} : { archivedPrices: prices.data.archived }),
      salesStates: salesStates.data ?? null,
    },
  };
}
