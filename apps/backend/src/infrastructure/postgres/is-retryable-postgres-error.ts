interface ErrorShape {
  readonly code?: unknown;
  readonly cause?: unknown;
  readonly errors?: unknown;
  readonly message?: unknown;
}

const retryableConnectionCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "40001",
  "40P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);

const retryableClientMessages = new Set([
  "Connection terminated",
  "Connection terminated unexpectedly",
  "Connection terminated due to connection timeout",
  "timeout exceeded when trying to connect",
]);

export function isRetryablePostgresError(error: unknown): boolean {
  const signals = errorSignals(error);
  return (
    signals.codes.some(
      (candidate) =>
        retryableConnectionCodes.has(candidate) || candidate.startsWith("08"),
    ) || signals.messages.some((message) => retryableClientMessages.has(message))
  );
}

function errorSignals(
  error: unknown,
  depth = 0,
): { readonly codes: readonly string[]; readonly messages: readonly string[] } {
  if (depth > 3) {
    return { codes: [], messages: [] };
  }
  const shape: ErrorShape =
    typeof error === "object" && error !== null ? error : {};
  const children = [
    ...(shape.cause === undefined ? [] : [shape.cause]),
    ...(isUnknownArray(shape.errors) ? shape.errors : []),
  ].map((child) => errorSignals(child, depth + 1));
  return {
    codes: [
      ...(typeof shape.code === "string" ? [shape.code] : []),
      ...children.flatMap((child) => child.codes),
    ],
    messages: [
      ...(typeof shape.message === "string" ? [shape.message] : []),
      ...children.flatMap((child) => child.messages),
    ],
  };
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
