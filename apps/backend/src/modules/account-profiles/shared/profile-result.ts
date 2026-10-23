import { randomUUID } from "node:crypto";

import type { AccountProfileError } from "../facets/account-profiles/account-profiles.interface.js";

export function profileFailure<Error extends AccountProfileError>(
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
