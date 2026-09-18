import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

/** Первое чтение политику ставит, второе — нет: проверка по файлу его бы пропустила. */
export async function readBoundedCatalog(slug: string): Promise<string> {
  "use cache";
  applyCatalogCachePolicy("available");
  return Promise.resolve(slug);
}

export async function readSecondCatalog(slug: string): Promise<string> {
  "use cache";
  return Promise.resolve(slug);
}
