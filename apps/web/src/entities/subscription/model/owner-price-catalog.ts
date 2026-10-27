import { z } from "zod";

import { priceSnapshotSchema, type PriceSnapshot } from "./billing-contract";

/** Одна страница `productPrices.list` в конверте владельческой операции. */
export const ownerPriceCatalogPageSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("catalogOffers"),
    items: z.array(priceSnapshotSchema),
    nextCursor: z.uuid().nullable(),
  }),
});
export const ownerPriceCatalogSchema = z.array(priceSnapshotSchema);

/** Ключ полного каталога цен владельца в TanStack Query: один на все поверхности админки. */
export const ownerPriceCatalogQueryKey = ["owner-price-catalog"] as const;

/** Страница `productPrices.list` за одно чтение каталога: столько принимает команда. */
export const OWNER_PRICE_CATALOG_PAGE_SIZE = 100;
/**
 * Больше страниц каталог не читает: такой каталог отвечает недоступностью, и экран показывает
 * «неизвестно», а не молча обрезанный список.
 */
export const OWNER_PRICE_CATALOG_PAGE_BUDGET = 20;

/** Продукт с действующей ценой: то, что можно выбрать для ссылки на оплату или скидки. */
export interface ProductPriceChoice {
  readonly productId: string;
  readonly name: string;
  readonly priceKopecks: number;
  readonly priceRevision: number;
  /** Снимок цены продукта для предпросмотра того, что увидит покупатель. */
  readonly snapshot: PriceSnapshot;
}

/**
 * Продукты каталога владельца, у которых есть неархивная цена, по названию. Снимок без продукта
 * (прежние предложения) выбрать нельзя: у него нет продукта, к которому привязать ссылку.
 */
export function productPriceChoices(
  catalog: readonly PriceSnapshot[],
): readonly ProductPriceChoice[] {
  const byProduct = new Map<string, ProductPriceChoice>();
  for (const snapshot of catalog) {
    const product = snapshot.product;
    if (product === undefined || snapshot.offer.archived) continue;
    if (byProduct.has(product.id)) continue;
    byProduct.set(product.id, {
      productId: product.id,
      name: product.name,
      priceKopecks: snapshot.paymentOption.priceKopecks,
      priceRevision: product.priceRevision,
      snapshot,
    });
  }
  return [...byProduct.values()].sort((left, right) =>
    left.name.localeCompare(right.name, "ru"),
  );
}
