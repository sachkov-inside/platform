/** Кеш-директива вне модуля гостевого чтения: правило именования держит такие чтения на виду. */
export async function readCatalogInline(slug: string): Promise<string> {
  "use cache";
  return Promise.resolve(slug);
}
