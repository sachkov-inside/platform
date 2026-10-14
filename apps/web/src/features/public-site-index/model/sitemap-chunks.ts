/** The sitemap protocol caps every emitted URL kind together at fifty thousand entries. */
const SITEMAP_URL_LIMIT = 50_000;

export function partitionPublicSitemap<T>(entries: readonly T[]): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < entries.length; offset += SITEMAP_URL_LIMIT) {
    chunks.push(entries.slice(offset, offset + SITEMAP_URL_LIMIT));
  }
  return chunks;
}
