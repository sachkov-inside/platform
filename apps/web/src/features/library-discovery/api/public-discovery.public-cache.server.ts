import "server-only";

import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

import type { PublishedProductResult } from "../model/library-discovery-view";
import { getPublishedProduct } from "./get-published-product";

/**
 * Продукт глазами гостя: справка, главы и карточки с гостевой доступностью. Общая часть страниц
 * продукта, программы и урока рисуется отсюда; доступность для вошедшего сюда не попадает (ADR 0027).
 */
export async function readPublicProduct(
  slug: string,
): Promise<PublishedProductResult> {
  "use cache";
  const result = await getPublishedProduct(slug);
  applyCatalogCachePolicy(result.kind);
  return result;
}
