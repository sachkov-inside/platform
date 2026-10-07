import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { queryOptions } from "@tanstack/react-query";

import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  bookmarkListPageSchema,
  bookmarkStateResultSchema,
  bookmarkStatesResultSchema,
  type BookmarkCommand,
  type BookmarkListResult,
  type BookmarkState,
} from "../model/bookmark-contract";

export async function getBookmarkStates(materialIds: readonly string[]) {
  const form = new FormData();
  materialIds.forEach((id) => {
    form.append("materialId", id);
  });
  const result = await requestSameOriginMutation(
    "/api/bookmarks/states",
    "POST",
    form,
  );
  if (!result.ok)
    return {
      kind: result.status === 401 ? "unauthorized" : "unavailable",
    } as const;
  const parsed = bookmarkStatesResultSchema.safeParse(result.body);
  if (!parsed.success) return { kind: "unavailable" } as const;
  return parsed.data.kind === "ready"
    ? { kind: "ready" as const, states: parsed.data.states }
    : parsed.data.kind === "unauthorized"
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const };
}

/** Состояния закладок личные, поэтому у гостя запрос выключен, а не отбит отказом 401. */
export function bookmarkStatesQueryOptions(input: {
  readonly materialId: string;
  readonly signedIn: boolean;
}) {
  return queryOptions({
    queryKey: ["bookmarks", "states", input.materialId],
    queryFn: () => getBookmarkStates([input.materialId]),
    enabled: input.signedIn,
    retry: false,
  });
}

export async function setBookmark(input: BookmarkCommand) {
  const form = new FormData();
  form.set("materialId", input.materialId);
  form.set("bookmarked", String(input.bookmarked));
  const result = await requestSameOriginMutation(
    "/api/bookmarks/state",
    "PUT",
    form,
  );
  if (!result.ok) {
    return {
      kind:
        result.status === 401
          ? "unauthorized"
          : result.status === 403
            ? "denied"
            : "unavailable",
    } as const;
  }
  const parsed = bookmarkStateResultSchema.safeParse(result.body);
  if (!parsed.success) return { kind: "unavailable" } as const;
  return parsed.data.kind === "ready"
    ? { kind: "ready" as const, state: parsed.data.state }
    : parsed.data.kind === "denied"
      ? { kind: "denied" as const }
      : parsed.data.kind === "unauthorized"
        ? { kind: "unauthorized" as const }
        : ({ kind: "unavailable" } as const);
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
