import type {
  Attributes,
  SpanContext,
  TextMapPropagator,
} from "@opentelemetry/api";
import { z } from "zod";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { SpanStatusCode } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

const operations = new Set([
  "send",
  "insert",
  "upsert",
  "flow",
  "publish",
  "receive",
  "process",
  "complete",
  "fail",
  "cancel",
  "delete",
]);
const jobIdSchema = z.guid();
const states = new Set(["deferred", "ready", "blocked", "active", "failed"]);

/** Values originate in a library: database names and error classes are deliberately excluded. */
export function pgBossAttributes(
  incoming: Attributes,
  queues: ReadonlySet<string>,
): Attributes {
  const attributes: Attributes = { "messaging.system": "pg-boss" };
  const queue = incoming["messaging.destination.name"];
  if (queue !== undefined)
    attributes["messaging.destination.name"] =
      typeof queue === "string" && queues.has(queue) ? queue : "_OTHER";
  const operation = incoming["messaging.operation.name"];
  if (typeof operation === "string")
    attributes["messaging.operation.name"] = operations.has(operation)
      ? operation
      : "_OTHER";
  const type = incoming["messaging.operation.type"];
  if (
    typeof type === "string" &&
    ["send", "receive", "process", "settle"].includes(type)
  )
    attributes["messaging.operation.type"] = type;
  const state = incoming["pgboss.job.state"];
  if (typeof state === "string" && states.has(state))
    attributes["pgboss.job.state"] = state;
  if (incoming["error.type"] !== undefined)
    attributes["error.type"] = "job_error";
  return attributes;
}

export function safePgBossSpan(
  span: ReadableSpan,
  queues: ReadonlySet<string>,
): ReadableSpan {
  const attributes = pgBossAttributes(span.attributes, queues);
  const id = span.attributes["messaging.message.id"];
  const parsedId = jobIdSchema.safeParse(id);
  if (parsedId.success) attributes["messaging.message.id"] = parsedId.data;
  for (const key of [
    "pgboss.job.retry_count",
    "messaging.batch.message_count",
  ]) {
    const value = span.attributes[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
      attributes[key] = value;
  }
  const current = traceContextSnapshot(span.spanContext());
  const parent =
    span.parentSpanContext === undefined
      ? undefined
      : traceContextSnapshot(span.parentSpanContext);
  return {
    spanContext: () => current,
    ...(parent === undefined ? {} : { parentSpanContext: parent }),
    kind: span.kind,
    startTime: [...span.startTime],
    endTime: [...span.endTime],
    duration: [...span.duration],
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    name: `${String(attributes["messaging.operation.name"] ?? "operation")} ${String(attributes["messaging.destination.name"] ?? "_OTHER")}`,
    attributes,
    status: {
      code:
        span.status.code === SpanStatusCode.ERROR
          ? SpanStatusCode.ERROR
          : SpanStatusCode.UNSET,
    },
    events: [],
    links: span.links.map((link) => ({
      context: traceContextSnapshot(link.context),
    })),
  };
}

/** Keep the official W3C parser/formatter, but never persist opaque tracestate or baggage. */
export function pgBossTracePropagator(): TextMapPropagator {
  const w3c = new W3CTraceContextPropagator();
  return {
    fields: () => ["traceparent"],
    inject: (current, carrier, setter) =>
      w3c.inject(current, carrier, {
        set: (target, key, value) => {
          if (key === "traceparent") setter.set(target, key, value);
        },
      }),
    extract: (current, carrier, getter) =>
      w3c.extract(current, carrier, {
        keys: () => ["traceparent"],
        get: (target, key) =>
          key === "traceparent" ? getter.get(target, key) : undefined,
      }),
  };
}

function traceContextSnapshot(value: SpanContext): SpanContext {
  return {
    traceId: value.traceId,
    spanId: value.spanId,
    traceFlags: value.traceFlags,
    isRemote: value.isRemote === true,
  };
}
