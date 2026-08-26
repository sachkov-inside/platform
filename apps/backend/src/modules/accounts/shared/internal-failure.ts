import { randomUUID } from "node:crypto";

import type { InternalAccountError } from "../facets/accounts/accounts.interface.js";

export function internalFailure(): {
  readonly ok: false;
  readonly error: InternalAccountError;
} {
  return {
    ok: false,
    error: { code: "internal_error", correlationId: randomUUID() },
  };
}
