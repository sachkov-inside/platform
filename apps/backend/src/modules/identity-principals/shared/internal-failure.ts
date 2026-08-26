import { randomUUID } from "node:crypto";

export function internalFailure(): {
  readonly ok: false;
  readonly error: { readonly code: "internal_error"; readonly correlationId: string };
} {
  return {
    ok: false,
    error: { code: "internal_error", correlationId: randomUUID() },
  };
}
