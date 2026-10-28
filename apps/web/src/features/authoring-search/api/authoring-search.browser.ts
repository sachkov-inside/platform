import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  authoringSearchStateSchema,
  type AuthoringSearchState,
} from "../model/authoring-search";

/** Чтение общего поиска через BFF; ответ проверяется схемой состояния этой фичи. */
export async function requestAuthoringSearch(
  query: string,
  signal: AbortSignal,
): Promise<AuthoringSearchState> {
  const result = await requestAuthenticatedRead(
    `/api/authoring/search?${new URLSearchParams({ query }).toString()}`,
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind === "rejected") {
    const parsed = authoringSearchStateSchema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : { kind: "unavailable", reference: result.reference ?? "search" };
  }
  if (result.kind !== "ready")
    return { kind: "unavailable", reference: result.reference ?? "search" };
  const parsed = authoringSearchStateSchema.safeParse(result.value);
  return parsed.success && parsed.data.kind === "ready"
    ? parsed.data
    : { kind: "unavailable", reference: "malformed-response" };
}
