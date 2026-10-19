import "server-only";

import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

import type { PublishedSeriesResult } from "../model/library-discovery-view";
import { getPublishedSeries } from "./get-published-series";

/**
 * Продукт глазами гостя: справка, главы и карточки с гостевой доступностью. Общая часть страниц
 * продукта, программы и урока рисуется отсюда; доступность для вошедшего сюда не попадает (ADR 0027).
 */
export async function readPublicSeries(
  slug: string,
): Promise<PublishedSeriesResult> {
  "use cache";
  const result = await getPublishedSeries(slug);
  applyCatalogCachePolicy(result.kind);
  return result;
}
