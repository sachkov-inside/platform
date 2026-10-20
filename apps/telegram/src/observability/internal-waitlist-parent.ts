import { parseTraceParent } from "@opentelemetry/core";

/** Only authenticated, strictly decoded internal waitlist continuations may call this guard. */
export function admitInternalWaitlistParent(
  rawHeaders: readonly string[],
): string | undefined {
  if (rawHeaders.length % 2 !== 0) return undefined;
  let occurrences = 0;
  let value: string | undefined;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const field = rawHeaders[index + 1];
    if (typeof name !== "string" || typeof field !== "string") return undefined;
    if (name.toLowerCase() !== "traceparent") continue;
    occurrences += 1;
    value = field;
  }
  if (occurrences !== 1 || value === undefined) return undefined;
  if (!/^00-[0-9a-f]{32}-[0-9a-f]{16}-(?:00|01)$/.test(value)) return undefined;
  return parseTraceParent(value) === null ? undefined : value;
}
