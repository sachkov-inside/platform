export const SERIES_PAGE_SIZE = 12;

/** Pagination changes the visible route only; composition and progress remain complete. */
export function seriesPage<T>(items: readonly T[], requestedPage: number) {
  const count = Math.max(1, Math.ceil(items.length / SERIES_PAGE_SIZE));
  const number = Math.min(count, Math.max(1, Math.trunc(requestedPage) || 1));
  const offset = (number - 1) * SERIES_PAGE_SIZE;
  const visible = new Set([1, count, number - 1, number, number + 1]);
  const pages: (number | null)[] = [];
  for (const page of [...visible].filter((value) => value > 0 && value <= count).sort((a, b) => a - b)) {
    const previous = pages.at(-1);
    if (typeof previous === "number" && page - previous > 1) pages.push(null);
    pages.push(page);
  }
  return { number, count, offset, items: items.slice(offset, offset + SERIES_PAGE_SIZE), pages };
}
