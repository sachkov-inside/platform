import { parseTraceParent } from "@opentelemetry/core";

/** One bounded W3C v00 carrier; never coerce arbitrary AMQP field-table values. */
export function notificationTraceparent(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length !== 55 ||
    !value.startsWith("00-")
  )
    return undefined;
  return parseTraceParent(value) === null ? undefined : value;
}
