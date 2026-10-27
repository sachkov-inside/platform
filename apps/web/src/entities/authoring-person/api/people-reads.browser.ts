import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  peopleIdentitiesStateSchema,
  peopleSearchStateSchema,
  type PeopleIdentitiesState,
  type PeopleSearchState,
} from "../model/people-reads";

/** Поиск людей через BFF; ответ проверяется схемой состояния. */
export function requestPeopleSearch(
  query: { readonly text: string; readonly limit: number },
  signal: AbortSignal,
): Promise<PeopleSearchState> {
  return readState(
    `/api/authoring/people/search?${new URLSearchParams({
      query: query.text,
      limit: String(query.limit),
    }).toString()}`,
    signal,
    peopleSearchStateSchema,
  );
}

/** Подписи набора людей через BFF; не больше 100 ID за чтение. */
export function requestPeopleIdentities(
  accountIds: readonly string[],
  signal: AbortSignal,
): Promise<PeopleIdentitiesState> {
  return readState(
    `/api/authoring/people/identities?${new URLSearchParams({
      accountIds: accountIds.join(","),
    }).toString()}`,
    signal,
    peopleIdentitiesStateSchema,
  );
}

async function readState<State extends { readonly kind: string }>(
  url: string,
  signal: AbortSignal,
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: State } | { success: false };
  },
): Promise<
  State | { kind: "signed_out" } | { kind: "unavailable"; reference: string }
> {
  const result = await requestAuthenticatedRead(url, signal);
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind === "rejected") {
    const parsed = schema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : { kind: "unavailable", reference: result.reference ?? "people" };
  }
  if (result.kind !== "ready")
    return { kind: "unavailable", reference: result.reference ?? "people" };
  const parsed = schema.safeParse(result.value);
  return parsed.success && parsed.data.kind === "ready"
    ? parsed.data
    : { kind: "unavailable", reference: "malformed-response" };
}
