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
  materialIds.forEach((id) => { form.append("materialId", id); });
  const result = await requestSameOriginMutation("/api/bookmarks/states", "POST", form);
  if (!result.ok) return { kind: result.status === 401 ? "unauthorized" : "unavailable" } as const;
  const parsed = bookmarkStatesResultSchema.safeParse(result.body);
  if (!parsed.success) return { kind: "unavailable" } as const;
  return parsed.data.kind === "ready"
    ? { kind: "ready" as const, states: parsed.data.states }
    : parsed.data.kind === "unauthorized"
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const };
}

export async function setBookmark(input: BookmarkCommand) {
  const form = new FormData();
  form.set("materialId", input.materialId);
  form.set("bookmarked", String(input.bookmarked));
  const result = await requestSameOriginMutation("/api/bookmarks/state", "PUT", form);
  if (!result.ok) {
    return {
      kind: result.status === 401 ? "unauthorized" : result.status === 403 ? "denied" : "unavailable",
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
        : { kind: "unavailable" } as const;
}

export async function listBookmarkPage(after?: string): Promise<BookmarkListResult> {
  const query = after === undefined ? "" : `?after=${encodeURIComponent(after)}`;
  let response: Response;
  try {
    response = await fetch(`/api/bookmarks${query}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401) return { kind: "unauthorized" };
  if (!response.ok) return { kind: "unavailable" };
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { kind: "unavailable" };
  }
  const parsed = bookmarkListPageSchema.safeParse(payload);
  return parsed.success ? { kind: "ready", ...parsed.data } : { kind: "unavailable" };
}

export type { BookmarkState };
