import "server-only";

import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

import type { ReaderProductArtifactsResult } from "../model/reader-product-artifacts";
import { readReaderProductArtifacts } from "./read-reader-product-artifacts.server";

/**
 * Артефакты продукта глазами гостя: названия и назначение видны каждому, а адрес закрытого
 * артефакта backend гостю не отдаёт. Доступность для вошедшего сюда не попадает (ADR 0027).
 */
export async function readPublicProductArtifacts(
  productId: string,
): Promise<ReaderProductArtifactsResult> {
  "use cache";
  const result = await readReaderProductArtifacts(productId);
  applyCatalogCachePolicy(result.kind);
  return result;
}
