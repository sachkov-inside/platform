/** Кеш на сессию попадает в предзагрузку, а закрытое содержимое предзагружать нельзя. */
export async function readPrivateCatalog(slug: string): Promise<string> {
  "use cache: private";
  applyCatalogCachePolicy("ready");
  return Promise.resolve(slug);
}

declare function applyCatalogCachePolicy(kind: string): void;
