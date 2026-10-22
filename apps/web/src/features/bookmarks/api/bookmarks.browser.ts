import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
  bookmarkListPageSchema,
  type BookmarkCommand,
  type BookmarkListResult,
  type BookmarkState,
} from "../model/bookmark-contract";

import {
  getBookmarkStatesOperation,
  setBookmarkOperation,
} from "./bookmarks.operation";

export function getBookmarkStates(materialIds: readonly string[]) {
  return getBookmarkStatesOperation.send({ materialIds: [...materialIds] });
}

/** Состояния закладок личные, поэтому у гостя запрос выключен, а не отбит отказом 401. */
export function bookmarkStatesQueryOptions(input: {
  readonly materialId: string;
  readonly accountId: string | null;
}) {
  return queryOptions({
    queryKey: ["bookmarks", input.accountId, "states", input.materialId],
    queryFn: () => getBookmarkStates([input.materialId]),
    enabled: input.accountId !== null,
    retry: false,
  });
}

export function setBookmark(input: BookmarkCommand) {
  return setBookmarkOperation.send(input);
}

export async function listBookmarkPage(
  after?: string,
): Promise<BookmarkListResult> {
  const query =
    after === undefined ? "" : `?after=${encodeURIComponent(after)}`;
  const result = await requestAuthenticatedRead(`/api/bookmarks${query}`);
  if (result.kind === "authentication_required")
    return { kind: "unauthorized" };
  if (result.kind !== "ready") return { kind: "unavailable" };
  const parsed = bookmarkListPageSchema.safeParse(result.value);
  return parsed.success
    ? { kind: "ready", ...parsed.data }
    : { kind: "unavailable" };
}

export type { BookmarkState };

/** Failed reads never become committed pages or consume their continuation cursor. */
export class BookmarkListReadError extends Error {
  constructor(readonly kind: "unauthorized" | "unavailable") {
    super(kind);
  }
}

export function bookmarkListQueryOptions(accountId: string | null) {
  return infiniteQueryOptions({
    queryKey: ["bookmarks", accountId, "list"],
    queryFn: async ({ pageParam }) => {
      const page = await listBookmarkPage(pageParam);
      if (page.kind !== "ready") throw new BookmarkListReadError(page.kind);
      return page;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
    enabled: accountId !== null,
  });
}
