/** Гостевое чтение без политики кеша: у записи нет тега, и авторская запись её не сбросит. */
export async function readUnboundedCatalog(slug: string): Promise<string> {
  "use cache";
  return Promise.resolve(slug);
}
