import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  peopleListStateSchema,
  serializePeopleListQuery,
  type PeopleListQuery,
  type PeopleListState,
} from "../model/people-list";

/** Список людей через BFF; отказ и сбой остаются состояниями списка. */
export async function requestPeopleList(
  query: PeopleListQuery,
  signal: AbortSignal,
): Promise<PeopleListState> {
  const search = serializePeopleListQuery(query, "query");
  const result = await requestAuthenticatedRead(
    search === "" ? "/api/authoring/people" : `/api/authoring/people?${search}`,
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind === "rejected") {
    const parsed = peopleListStateSchema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : { kind: "unavailable", reference: result.reference ?? "people-list" };
  }
  if (result.kind !== "ready")
    return {
      kind: "unavailable",
      reference: result.reference ?? "people-list",
    };
  const parsed = peopleListStateSchema.safeParse(result.value);
  return parsed.success && parsed.data.kind === "ready"
    ? parsed.data
    : { kind: "unavailable", reference: "malformed-response" };
}
