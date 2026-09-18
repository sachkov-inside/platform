/** Чтение с токеном под общим кешем: ответ одного читателя достался бы всем. */
export async function readPersonalCatalog(slug: string, accessToken: string): Promise<string> {
  "use cache";
  applyCatalogCachePolicy("ready");
  return Promise.resolve(`${slug}:${accessToken}`);
}

declare function applyCatalogCachePolicy(kind: string): void;
