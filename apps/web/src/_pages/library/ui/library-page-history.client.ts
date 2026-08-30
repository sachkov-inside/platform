"use client";

import {
  serializeLibrarySearchQuery,
  type LibrarySearchQuery,
} from "../model/library-search-query";

export function pushLibraryContinuationHistory(
  query: LibrarySearchQuery,
  after: string,
): void {
  const search = serializeLibrarySearchQuery({ ...query, after });
  const href = `${window.location.pathname}?${search}`;
  if (`${window.location.pathname}${window.location.search}` === href) {
    return;
  }
  window.history.pushState(null, "", href);
}
