import { randomUUID } from "node:crypto";

import type { MemberProfileError } from "../facets/member-profiles/member-profiles.interface.js";

export function profileFailure<Error extends MemberProfileError>(
  error: Error,
): Readonly<{ ok: false; error: Error }> {
  return { ok: false, error };
}

export function internalProfileError(): Readonly<{
  code: "internal_error";
  correlationId: string;
}> {
  return { code: "internal_error", correlationId: randomUUID() };
}
