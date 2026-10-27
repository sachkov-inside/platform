import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  personCardStateSchema,
  type PersonCardState,
} from "../model/person-card";

/** Карточка через BFF; отказ и сбой остаются состояниями карточки. */
export async function requestPersonCard(
  accountId: string,
  signal: AbortSignal,
): Promise<PersonCardState> {
  const result = await requestAuthenticatedRead(
    `/api/authoring/people/${encodeURIComponent(accountId)}`,
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind === "rejected") {
    const parsed = personCardStateSchema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : { kind: "unavailable", reference: result.reference ?? "person-card" };
  }
  if (result.kind !== "ready")
    return {
      kind: "unavailable",
      reference: result.reference ?? "person-card",
    };
  const parsed = personCardStateSchema.safeParse(result.value);
  return parsed.success && parsed.data.kind === "ready"
    ? parsed.data
    : { kind: "unavailable", reference: "malformed-response" };
}
