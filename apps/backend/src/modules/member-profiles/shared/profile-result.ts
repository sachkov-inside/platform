import { randomUUID } from "node:crypto";

import type {
  MemberProfileError,
  MemberProfileResult,
} from "../facets/member-profiles/member-profiles.interface.js";

export function profileFailure<Value>(
  error: MemberProfileError,
): MemberProfileResult<Value> {
  return { ok: false, error };
}

export function internalProfileError(): Readonly<{
  code: "internal_error";
  correlationId: string;
}> {
  return { code: "internal_error", correlationId: randomUUID() };
}
