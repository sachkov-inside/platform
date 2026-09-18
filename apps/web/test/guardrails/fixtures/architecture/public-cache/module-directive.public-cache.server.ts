"use cache";

import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

/** Директива на уровне модуля кеширует и функции, которые политику не ставят. */
export async function readModuleCatalog(slug: string): Promise<string> {
  applyCatalogCachePolicy("available");
  return Promise.resolve(slug);
}
