import {
  SpanStatusCode,
  type Attributes,
  type SpanContext,
} from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

export const emailOperations = {
  publishMaterial: {
    operation: "publish",
    lane: "emailMaterial",
    destination: "inside.notifications.email.v1",
  },
  receiveMaterial: {
    operation: "receive",
    lane: "emailMaterial",
    destination: "inside.notifications.email.v1",
  },
  dispatchMaterial: {
    operation: "dispatch",
    lane: "emailMaterial",
    destination: "inside.notifications.email.v1",
  },
  publishSubscription: {
    operation: "publish",
    lane: "emailSubscription",
    destination: "inside.notifications.email.v1",
  },
  receiveSubscription: {
    operation: "receive",
    lane: "emailSubscription",
    destination: "inside.notifications.email.v1",
  },
  dispatchSubscription: {
    operation: "dispatch",
    lane: "emailSubscription",
    destination: "inside.notifications.email.v1",
  },
  publishResult: {
    operation: "publish",
    lane: "emailResult",
    destination: "inside.results.email.v1",
  },
  receiveResult: {
    operation: "receive",
    lane: "emailResult",
    destination: "inside.results.email.v1",
  },
  projectResult: {
    operation: "project",
    lane: "emailResult",
    destination: "inside.results.email.v1",
  },
} as const;
export type EmailOperation = keyof typeof emailOperations;

/** Snapshot the closed application contract before any span enters the retained batch. */
export function safeEmailSpan(span: ReadableSpan): ReadableSpan {
  const attributes: Attributes = {};
  let name = "email operation";
  const registered = Object.values(emailOperations).find(
    (item) => `${item.operation} ${item.lane}` === span.name,
  );
  if (registered !== undefined) {
    name = `${registered.operation} ${registered.lane}`;
    Object.assign(attributes, {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": registered.destination,
      "messaging.operation.name": registered.operation,
      "email.lane": registered.lane,
    });
    if (span.status.code === SpanStatusCode.ERROR)
      attributes["error.type"] = "email_operation_failed";
  } else if (span.name === "smtp send") {
    name = "smtp send";
    const state = span.attributes["dependency.outcome"];
    Object.assign(attributes, {
      "dependency.name": "smtp",
      "dependency.operation": "send",
      "dependency.outcome":
        typeof state === "string" &&
        ["sent", "not_sent", "failed", "unknown"].includes(state)
          ? state
          : "unknown",
    });
  }
  const snapshot = (value: SpanContext): SpanContext => ({
    traceId: value.traceId,
    spanId: value.spanId,
    traceFlags: value.traceFlags,
    isRemote: value.isRemote === true,
  });
  const current = snapshot(span.spanContext());
  return {
    spanContext: () => current,
    ...(span.parentSpanContext === undefined
      ? {}
      : { parentSpanContext: snapshot(span.parentSpanContext) }),
    name,
    attributes,
    kind: span.kind,
    startTime: [...span.startTime],
    endTime: [...span.endTime],
    duration: [...span.duration],
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: { name: "inside-email" },
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
    events: [],
    links: [],
    status: {
      code:
        span.status.code === SpanStatusCode.ERROR
          ? SpanStatusCode.ERROR
          : SpanStatusCode.UNSET,
    },
  };
}
