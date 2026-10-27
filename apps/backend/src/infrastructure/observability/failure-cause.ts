type FailureCategory =
  | "constraint"
  | "timeout"
  | "connection"
  | "authorization"
  | "capacity"
  | "conflict"
  | "cancelled"
  | "unknown";

export interface FailureCause {
  readonly category: FailureCategory;
  readonly code: string;
}

// Exact owned diagnostic vocabulary. Never echo an arbitrary class, code or message.
const categories: Readonly<Record<string, FailureCategory>> = {
  "23502": "constraint",
  "23503": "constraint",
  "23505": "constraint",
  "23514": "constraint",
  "57014": "timeout",
  "55P03": "timeout",
  "08000": "connection",
  "08001": "connection",
  "08003": "connection",
  "08004": "connection",
  "08006": "connection",
  "08007": "connection",
  "08P01": "connection",
  "57P01": "connection",
  "57P02": "connection",
  "57P03": "connection",
  "28000": "authorization",
  "28P01": "authorization",
  "42501": "authorization",
  "53100": "capacity",
  "53200": "capacity",
  "53300": "capacity",
  "53400": "capacity",
  "40001": "conflict",
  "40P01": "conflict",
  P1000: "authorization",
  P1001: "connection",
  P1002: "timeout",
  P1008: "timeout",
  P1017: "connection",
  P2002: "constraint",
  P2003: "constraint",
  P2024: "timeout",
  P2034: "conflict",
  ECONNREFUSED: "connection",
  ECONNRESET: "connection",
  EPIPE: "connection",
  ENOTFOUND: "connection",
  EAI_AGAIN: "connection",
  ETIMEDOUT: "timeout",
  TimeoutError: "timeout",
  AbortError: "cancelled",
};
const codes = new Map(Object.entries(categories));
const MAX_CAUSE_DEPTH = 4;
const MAX_CAUSE_NODES = 16;

function ownValue(value: unknown, key: string): unknown {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  )
    return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Inspect bounded own data properties only; getters, SQL, text, targets and stacks are excluded. */
export function classifyFailure(error: unknown): FailureCause {
  const pending = [{ value: error, depth: 0 }];
  const seen = new Set<unknown>();
  let visited = 0;
  while (pending.length > 0 && visited < MAX_CAUSE_NODES) {
    const current = pending.shift();
    if (current === undefined) break;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    visited += 1;
    for (const key of ["code", "originalCode", "kind", "name"]) {
      const code = ownValue(current.value, key);
      const category = typeof code === "string" ? codes.get(code) : undefined;
      if (category !== undefined && typeof code === "string")
        return { category, code };
    }
    if (current.depth >= MAX_CAUSE_DEPTH) continue;
    for (const key of ["cause", "meta", "driverAdapterError"]) {
      const value = ownValue(current.value, key);
      if (value !== undefined)
        pending.push({ value, depth: current.depth + 1 });
    }
    const errors = ownValue(current.value, "errors");
    if (Array.isArray(errors)) {
      for (let index = 0; index < 3; index += 1) {
        const value = ownValue(errors, String(index));
        if (value !== undefined)
          pending.push({ value, depth: current.depth + 1 });
      }
    }
  }
  return { category: "unknown", code: "unknown" };
}
