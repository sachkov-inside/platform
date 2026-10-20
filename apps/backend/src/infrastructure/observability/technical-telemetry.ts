import {
  context,
  createContextKey,
  trace,
  ROOT_CONTEXT,
  TraceFlags,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Tracer,
  type Span,
} from "@opentelemetry/api";
import type { OpenTelemetryOptions } from "pg-boss";
import {
  pgBossAttributes,
  pgBossTracePropagator,
  safePgBossSpan,
} from "./pg-boss-telemetry.js";
import {
  emailOperations,
  safeEmailSpan,
  type EmailOperation,
} from "./email-telemetry-contract.js";
import { notificationTraceparent } from "./notification-trace.js";
import { ExportResultCode } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  TraceIdRatioBasedSampler,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";

import { acquireTechnicalContext } from "./technical-context.js";
import { TELEMETRY_EXPORT_TIMEOUT_MS } from "./technical-telemetry-policy.js";

const MAX_PENDING_SPANS = 512;
// Local reference budget, independent of pool connection limits and metric cardinality.
const MAX_OBSERVED_POSTGRES_POOLS = 16;

const EXPORT_INTERVAL_MS = 5_000;
const technicalScopeKey = createContextKey("inside.technical.scope");
class TechnicalScope {
  constructor(
    readonly correlation: Readonly<Record<string, string | boolean>>,
    readonly dependencyTracer: Tracer,
    readonly recordDependency: (
      dependency:
        "kinescope" | "postgresql" | "tbank" | "logto" | "telegram" | "s3",
      operation:
        | KinescopeOperation
        | PostgresOperation
        | TbankOperation
        | "jwks"
        | CommunityOperation
        | TelegramHttpOperation
        | S3Operation
        | "communications.execute"
        | "waitlist.confirm",
      failed: boolean,
      seconds: number,
    ) => void,
    readonly emailTracer: Tracer,
    readonly recordEmail: (
      operation: EmailOperation | "smtpSend",
      outcome: EmailOutcome,
      seconds: number,
    ) => void,
    readonly observePool: (
      owner: object,
      read: () => PostgresPoolSnapshot,
    ) => void,
    readonly notificationTracer: Tracer,
    readonly recordNotification: (
      operation: NotificationOperation,
      failed: boolean,
      seconds: number,
    ) => void,
  ) {}
}

type S3Operation = "http.GET" | "http.PUT" | "http.DELETE" | "getObject.read";

/** HTTP attempts stop at handler settlement; the separate read operation owns existing body work. */
export async function observeS3Operation<Value>(
  operation: S3Operation,
  work: (observation: { response(status: number): void }) => Promise<Value>,
): Promise<Value> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope))
    return work({ response: () => undefined });
  const read = operation === "getObject.read";
  const span = scope.dependencyTracer.startSpan(
    `s3 ${operation}`,
    {
      kind: read ? SpanKind.INTERNAL : SpanKind.CLIENT,
      attributes: {
        "dependency.name": "s3",
        "dependency.operation": operation,
        ...(!read ? { "http.request.method": operation.slice(5) } : {}),
      },
    },
    current,
  );
  const started = performance.now();
  let failed = false;
  try {
    return await context.with(trace.setSpan(current, span), () =>
      work({
        response: (status) => {
          if (
            !read &&
            Number.isInteger(status) &&
            status >= 100 &&
            status <= 599
          ) {
            span.setAttribute("http.response.status_code", status);
            if (status >= 400) failed = true;
          }
        },
      }),
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    span.setAttribute("dependency.outcome", failed ? "failed" : "completed");
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
    scope.recordDependency(
      "s3",
      operation,
      failed,
      (performance.now() - started) / 1_000,
    );
    span.end();
  }
}

type CommunityOperation = "community.set" | "community.status";

/** One admitted community POST, including its existing JSON and correlation checks. */
export async function observeCommunityExchange<Value>(
  operation: CommunityOperation,
  work: (observation: {
    response(status: number): void;
    fail(): void;
  }) => Promise<Value>,
): Promise<Value> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope))
    return work({ response: () => undefined, fail: () => undefined });
  const span = scope.dependencyTracer.startSpan(
    `telegram ${operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "dependency.name": "telegram",
        "dependency.operation": operation,
        "http.request.method": "POST",
      },
    },
    current,
  );
  const started = performance.now();
  let failed = false;
  try {
    return await context.with(trace.setSpan(current, span), () =>
      work({
        response: (status) => {
          if (Number.isInteger(status) && status >= 100 && status <= 599)
            span.setAttribute("http.response.status_code", status);
        },
        fail: () => {
          failed = true;
        },
      }),
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    span.setAttribute("dependency.outcome", failed ? "failed" : "completed");
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
    scope.recordDependency(
      "telegram",
      operation,
      failed,
      (performance.now() - started) / 1_000,
    );
    span.end();
  }
}

/** Native JWKS fetch through response headers; JOSE owns later body/validation work. */
export async function observeLogtoJwksRequest(
  work: () => Promise<Response>,
): Promise<Response> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope)) return work();
  const span = scope.dependencyTracer.startSpan(
    "logto jwks",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "dependency.name": "logto",
        "dependency.operation": "jwks",
        "http.request.method": "GET",
      },
    },
    current,
  );
  const started = performance.now();
  let failed = false;
  try {
    const response = await context.with(trace.setSpan(current, span), work);
    if (
      Number.isInteger(response.status) &&
      response.status >= 100 &&
      response.status <= 599
    )
      span.setAttribute("http.response.status_code", response.status);
    failed = response.status !== 200;
    return response;
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    span.setAttribute("dependency.outcome", failed ? "failed" : "completed");
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
    scope.recordDependency(
      "logto",
      "jwks",
      failed,
      (performance.now() - started) / 1_000,
    );
    span.end();
  }
}

export type TbankOperation =
  | "Init"
  | "GetState"
  | "CheckOrder"
  | "Charge"
  | "Cancel"
  | "AddCard"
  | "GetAddCardState";

/** Bank request plus its existing JSON read, excluding later domain validation. */
export async function observeTbankRequest<Value>(
  operation: TbankOperation,
  work: () => Promise<Value>,
): Promise<Value> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope)) return work();
  const span = scope.dependencyTracer.startSpan(
    `tbank ${operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "dependency.name": "tbank",
        "dependency.operation": operation,
        "http.request.method": "POST",
      },
    },
    current,
  );
  const started = performance.now();
  let failed = false;
  try {
    return await context.with(trace.setSpan(current, span), work);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    span.setAttribute("dependency.outcome", failed ? "failed" : "completed");
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
    scope.recordDependency(
      "tbank",
      operation,
      failed,
      (performance.now() - started) / 1_000,
    );
    span.end();
  }
}

/** Existing communications POST plus its single JSON read, before protocol validation. */
export async function observeCommunicationsRequest<Value>(
  work: (response: (status: number) => void) => Promise<Value>,
): Promise<Value> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope)) return work(() => undefined);
  const span = scope.dependencyTracer.startSpan(
    "telegram communications.execute",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "dependency.name": "telegram",
        "dependency.operation": "communications.execute",
        "http.request.method": "POST",
      },
    },
    current,
  );
  const started = performance.now();
  let failed = false;
  try {
    return await context.with(trace.setSpan(current, span), () =>
      work((status) => {
        if (Number.isInteger(status) && status >= 100 && status <= 599) {
          span.setAttribute("http.response.status_code", status);
          if (status >= 400) failed = true;
        }
      }),
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    span.setAttribute("dependency.outcome", failed ? "failed" : "completed");
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
    scope.recordDependency(
      "telegram",
      "communications.execute",
      failed,
      (performance.now() - started) / 1_000,
    );
    span.end();
  }
}

/** Existing waitlist receipt POST and its existing response validation. */
export async function observeWaitlistConfirmationRequest<Value>(
  work: (response: (status: number) => void) => Promise<Value>,
): Promise<Value> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope)) return work(() => undefined);
  const span = scope.dependencyTracer.startSpan(
    "telegram waitlist.confirm",
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "dependency.name": "telegram",
        "dependency.operation": "waitlist.confirm",
        "http.request.method": "POST",
      },
    },
    current,
  );
  const started = performance.now();
  let failed = false;
  try {
    return await context.with(trace.setSpan(current, span), () =>
      work((status) => {
        if (Number.isInteger(status) && status >= 100 && status <= 599) {
          span.setAttribute("http.response.status_code", status);
          if (status >= 400) failed = true;
        }
      }),
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    span.setAttribute("dependency.outcome", failed ? "failed" : "completed");
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
    scope.recordDependency(
      "telegram",
      "waitlist.confirm",
      failed,
      (performance.now() - started) / 1_000,
    );
    span.end();
  }
}

type TelegramHttpOperation =
  "link.register" | "link.confirm" | "contacts.read" | "signin.bindAccount";

export interface TelegramHttpObservation {
  admit(): void;
  response(status: number): void;
  completed(): void;
}

/** One admitted native fetch invocation through existing protocol validation, not a socket count. */
export async function observeTelegramHttp<Value>(
  operation: TelegramHttpOperation,
  work: (observation: TelegramHttpObservation) => Promise<Value>,
): Promise<Value> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  let span: Span | undefined;
  let started = 0;
  const outcome = { failed: true };
  try {
    return await work({
      admit() {
        if (!(scope instanceof TechnicalScope)) return;
        started = performance.now();
        span = scope.dependencyTracer.startSpan(
          `telegram ${operation}`,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              "dependency.name": "telegram",
              "dependency.operation": operation,
              "http.request.method": "POST",
            },
          },
          current,
        );
      },
      response(status) {
        if (Number.isInteger(status) && status >= 100 && status <= 599)
          span?.setAttribute("http.response.status_code", status);
      },
      completed() {
        outcome.failed = false;
      },
    });
  } finally {
    if (span !== undefined && scope instanceof TechnicalScope) {
      span.setAttribute(
        "dependency.outcome",
        outcome.failed ? "failed" : "completed",
      );
      if (outcome.failed) span.setStatus({ code: SpanStatusCode.ERROR });
      scope.recordDependency(
        "telegram",
        operation,
        outcome.failed,
        (performance.now() - started) / 1_000,
      );
      span.end();
    }
  }
}

type NotificationOperation = "publish" | "receive" | "audience";

type EmailOutcome = "completed" | "failed" | "sent" | "not_sent" | "unknown";

/** Each durable email row resumes only its immutable carrier, never the sweep's ambient parent. */
export async function observeEmailNotification<Value>(
  operation: EmailOperation,
  parent: unknown,
  work: (traceparent: string | undefined) => Promise<Value>,
): Promise<Value> {
  const scope = context.active().getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope)) return work(undefined);
  const valid = notificationTraceparent(parent);
  const root = ROOT_CONTEXT.setValue(technicalScopeKey, scope);
  const causal =
    valid === undefined
      ? root
      : pgBossTracePropagator().extract(
          root,
          { traceparent: valid },
          {
            keys: () => ["traceparent"],
            get: (carrier: Readonly<Record<string, string>>, key: string) =>
              key === "traceparent" ? carrier["traceparent"] : undefined,
          },
        );
  const registered = emailOperations[operation];
  const span = scope.emailTracer.startSpan(
    `${registered.operation} ${registered.lane}`,
    {
      kind:
        registered.operation === "publish"
          ? SpanKind.PRODUCER
          : registered.operation === "receive"
            ? SpanKind.CONSUMER
            : SpanKind.INTERNAL,
      attributes: {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": registered.destination,
        "messaging.operation.name": registered.operation,
        "email.lane": registered.lane,
      },
    },
    causal,
  );
  const started = performance.now();
  let failed = false;
  try {
    return await context.with(trace.setSpan(causal, span), () =>
      work(valid === undefined ? undefined : captureNotificationTraceparent()),
    );
  } catch (error) {
    failed = true;
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.setAttribute("error.type", "email_operation_failed");
    throw error;
  } finally {
    scope.recordEmail(
      operation,
      failed ? "failed" : "completed",
      (performance.now() - started) / 1_000,
    );
    span.end();
  }
}

/** Count one actual sender invocation, independently of its delivery certainty and trace sampling. */
export async function observeSmtpSend<
  Value extends { readonly state: "sent" | "not_sent" | "failed" | "unknown" },
>(work: () => Promise<Value>): Promise<Value> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope)) return work();
  const span = scope.emailTracer.startSpan(
    "smtp send",
    {
      kind: SpanKind.CLIENT,
      attributes: { "dependency.name": "smtp", "dependency.operation": "send" },
    },
    current,
  );
  const started = performance.now();
  let outcome: EmailOutcome = "unknown";
  try {
    const result = await context.with(trace.setSpan(current, span), work);
    // A malformed port result must never become an unbounded metric label.
    if (
      result.state === "sent" ||
      result.state === "not_sent" ||
      result.state === "failed"
    )
      outcome = result.state;
    return result;
  } finally {
    span.setAttribute("dependency.outcome", outcome);
    if (outcome !== "sent") span.setStatus({ code: SpanStatusCode.ERROR });
    scope.recordEmail(
      "smtpSend",
      outcome,
      (performance.now() - started) / 1_000,
    );
    span.end();
  }
}

type KinescopeOperation = "delete" | "find" | "initUpload";
interface KinescopeObservation {
  response(status: number): void;
  fail(): void;
}

/** Full adapter-operation duration, including only response work the adapter already performs. */
export async function observeKinescopeOperation<Value>(
  operation: KinescopeOperation,
  work: (observation: KinescopeObservation) => Promise<Value>,
): Promise<Value> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope))
    return work({ response: () => undefined, fail: () => undefined });
  const span = scope.dependencyTracer.startSpan(
    `kinescope ${operation}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "dependency.name": "kinescope",
        "dependency.operation": operation,
        "http.request.method":
          operation === "delete"
            ? "DELETE"
            : operation === "find"
              ? "GET"
              : "POST",
      },
    },
    current,
  );
  const started = performance.now();
  let failed = false;
  try {
    return await context.with(trace.setSpan(current, span), () =>
      work({
        response: (status) => {
          if (Number.isInteger(status) && status >= 100 && status <= 599) {
            span.setAttribute("http.response.status_code", status);
            if (
              status >= 400 &&
              !(status === 404 && operation !== "initUpload")
            )
              failed = true;
          }
        },
        fail: () => {
          failed = true;
        },
      }),
    );
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    span.setAttribute("dependency.outcome", failed ? "failed" : "completed");
    if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
    scope.recordDependency(
      "kinescope",
      operation,
      failed,
      (performance.now() - started) / 1_000,
    );
    span.end();
  }
}

interface PostgresPoolSnapshot {
  available: boolean;
  total: number;
  idle: number;
  waiting: number;
}

/** Register only this process's Prisma-owned pools; readers inspect live public counts without I/O. */
export function observePostgresPool(
  owner: object,
  read: () => PostgresPoolSnapshot,
): void {
  const scope = context.active().getValue(technicalScopeKey);
  if (scope instanceof TechnicalScope) scope.observePool(owner, read);
}

type PostgresOperation = "query" | "acquire" | "material-slug-lock";

/** Driver wall duration and acquisition are distinct observations; no SQL or errors enter here. */
export function beginPostgresObservation(operation: PostgresOperation): {
  run<Value>(work: () => Value): Value;
  complete<Value>(failed: boolean, work: () => Value): Value;
} {
  const parent = context.active();
  const scope = parent.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope))
    return { run: (work) => work(), complete: (_failed, work) => work() };
  const span = scope.dependencyTracer.startSpan(
    `postgresql ${operation}`,
    {
      kind:
        operation === "material-slug-lock"
          ? SpanKind.INTERNAL
          : SpanKind.CLIENT,
      attributes: {
        "dependency.name": "postgresql",
        "dependency.operation": operation,
      },
    },
    parent,
  );
  const started = performance.now();
  let completed = false;
  return {
    run: (work) => context.with(trace.setSpan(parent, span), work),
    complete: (failed, work) => {
      if (!completed) {
        completed = true;
        span.setAttribute(
          "dependency.outcome",
          failed ? "failed" : "completed",
        );
        if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
        scope.recordDependency(
          "postgresql",
          operation,
          failed,
          (performance.now() - started) / 1_000,
        );
        span.end();
      }
      return context.with(parent, work);
    },
  };
}

/** Capture only a span inside this application's enabled, owned technical scope. */
export function captureNotificationTraceparent(): string | undefined {
  if (!(context.active().getValue(technicalScopeKey) instanceof TechnicalScope))
    return undefined;
  const carrier: Record<string, string> = {};
  pgBossTracePropagator().inject(context.active(), carrier, {
    set: (target: Record<string, string>, key: string, value: string) => {
      target[key] = value;
    },
  });
  return notificationTraceparent(carrier["traceparent"]);
}

/** Per durable row/attempt, from its persisted parent; never inherit a sweep's unrelated trace. */
export async function observeNotification<Value>(
  operation: NotificationOperation,
  parent: unknown,
  work: (traceparent: string | undefined) => Promise<Value>,
): Promise<Value> {
  const scope = context.active().getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope)) return work(undefined);
  const valid = notificationTraceparent(parent);
  const root = ROOT_CONTEXT.setValue(technicalScopeKey, scope);
  const causal =
    valid === undefined
      ? root
      : pgBossTracePropagator().extract(
          root,
          { traceparent: valid },
          {
            keys: () => ["traceparent"],
            get: (carrier: Readonly<Record<string, string>>, key: string) =>
              key === "traceparent" ? carrier["traceparent"] : undefined,
          },
        );
  const span = scope.notificationTracer.startSpan(
    `${operation} materials`,
    {
      kind:
        operation === "publish"
          ? SpanKind.PRODUCER
          : operation === "receive"
            ? SpanKind.CONSUMER
            : SpanKind.INTERNAL,
      attributes: {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "inside.events.materials.v1",
        "messaging.operation.name": operation,
      },
    },
    causal,
  );
  const start = performance.now();
  let failed = false;
  try {
    return await context.with(trace.setSpan(causal, span), () =>
      work(valid === undefined ? undefined : captureNotificationTraceparent()),
    );
  } catch (error) {
    failed = true;
    span.setAttribute("error.type", "notification_operation_failed");
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    scope.recordNotification(
      operation,
      failed,
      (performance.now() - start) / 1_000,
    );
    span.end();
  }
}

export function technicalLogCorrelation(): Readonly<
  Record<string, string | boolean>
> {
  const current = context.active();
  const scope = current.getValue(technicalScopeKey);
  if (!(scope instanceof TechnicalScope)) return {};
  const active = trace.getSpan(current)?.spanContext();
  return active === undefined
    ? scope.correlation
    : {
        ...scope.correlation,
        traceId: active.traceId,
        spanId: active.spanId,
        traceSampled: (active.traceFlags & TraceFlags.SAMPLED) !== 0,
      };
}

export type TechnicalService =
  | "platform-api"
  | "platform-mcp"
  | "platform-material-assets-worker"
  | "platform-profile-avatars-worker"
  | "platform-video-deletions-worker"
  | "platform-billing-worker"
  | "platform-notifications-worker";

interface EnabledConfiguration {
  readonly enabled: true;
  readonly service: TechnicalService;
  readonly environment: "development" | "test" | "production";
  readonly release: string;
  readonly sampleRatio: number;
  readonly onContextUnavailable?: () => void;
  readonly onExportFailure?: (signal: "traces" | "metrics") => void;
  readonly exporters: {
    readonly spans: SpanExporter;
    readonly metrics: PushMetricExporter;
  };
}

export interface HttpObservation {
  run<Value>(work: () => Value): Value;
  finish(
    status: number | undefined,
    durationMs: number,
    outcome?: "completed" | "aborted" | "timeout",
  ): void;
}
export interface TechnicalTelemetry {
  pgBoss(queues: readonly string[]): OpenTelemetryOptions;
  runJob<Value>(work: () => Value): Value;
  runTrackingDelivery<Value>(
    parent: unknown,
    work: (observation: { fail(): void }) => Promise<Value>,
  ): Promise<Value>;
  runWaitlistDelivery<Value>(
    parent: unknown,
    work: (observation: { fail(): void }) => Promise<Value>,
  ): Promise<Value>;
  startHttp(input: {
    readonly method: string;
    readonly route?: string;
  }): HttpObservation;
  correlation(): Readonly<Record<string, string | boolean>>;
  diagnostics(): {
    readonly droppedSpans: number;
    readonly failedTraceExports: number;
    readonly failedMetricExports: number;
  };
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/** Explicit instrumentation only: callers supply registered route templates, never URLs or errors. */
export function createTechnicalTelemetry(
  configuration: EnabledConfiguration | { readonly enabled: false },
): TechnicalTelemetry {
  let droppedSpans = 0;
  let failedTraceExports = 0;
  let failedMetricExports = 0;
  if (!configuration.enabled)
    return {
      pgBoss: () => ({ enabled: false }),
      runJob: (work) =>
        context.with(context.active().deleteValue(technicalScopeKey), work),
      runTrackingDelivery: (_parent, work) =>
        context.with(ROOT_CONTEXT, () => work({ fail: () => undefined })),
      runWaitlistDelivery: (_parent, work) =>
        context.with(ROOT_CONTEXT, () => work({ fail: () => undefined })),
      startHttp: () => ({
        run: (work) =>
          context.with(context.active().deleteValue(technicalScopeKey), work),
        finish: () => undefined,
      }),
      correlation: () => ({}),
      diagnostics: () => ({
        droppedSpans,
        failedTraceExports,
        failedMetricExports,
      }),
      flush: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
    };
  const lease = acquireTechnicalContext();
  if (lease === undefined) {
    configuration.onContextUnavailable?.();
    const cleanup = Promise.allSettled([
      Promise.resolve().then(() => configuration.exporters.spans.shutdown()),
      Promise.resolve().then(() => configuration.exporters.metrics.shutdown()),
    ]).then(() => undefined);
    return {
      ...createTechnicalTelemetry({ enabled: false }),
      shutdown: () => cleanup,
    };
  }
  let traceRuntime: BasicTracerProvider | undefined;
  let metricRuntime: MeterProvider | undefined;
  try {
    const identity = {
      service: configuration.service,
      environment: configuration.environment,
      release: configuration.release,
    };
    const resource = resourceFromAttributes({
      "service.name": identity.service,
      "deployment.environment.name": identity.environment,
      "service.version": identity.release,
    });
    const queues = new Set<string>();
    let pending = 0;
    const spanExporter: SpanExporter = {
      export: (spans, callback) =>
        configuration.exporters.spans.export(spans, (result) => {
          pending -= spans.length;
          if (result.code !== ExportResultCode.SUCCESS) {
            failedTraceExports++;
            configuration.onExportFailure?.("traces");
          }
          callback(result);
        }),
      shutdown: () => configuration.exporters.spans.shutdown(),
    };
    const batch = new BatchSpanProcessor(spanExporter, {
      maxQueueSize: MAX_PENDING_SPANS,
      maxExportBatchSize: 64,
      scheduledDelayMillis: EXPORT_INTERVAL_MS,
      exportTimeoutMillis: TELEMETRY_EXPORT_TIMEOUT_MS,
    });
    const traces = (traceRuntime = new BasicTracerProvider({
      resource,
      sampler: new TraceIdRatioBasedSampler(configuration.sampleRatio),
      spanLimits: {
        attributeCountLimit: 16,
        attributeValueLengthLimit: 160,
        eventCountLimit: 0,
        linkCountLimit: 32,
      },
      spanProcessors: [
        {
          onStart: () => undefined,
          onEnd: (span) => {
            if ((span.spanContext().traceFlags & TraceFlags.SAMPLED) === 0)
              return;
            if (pending >= MAX_PENDING_SPANS) {
              droppedSpans++;
              return;
            }
            pending++;
            batch.onEnd(
              span.instrumentationScope.name === "pg-boss"
                ? safePgBossSpan(span, queues)
                : span.instrumentationScope.name === "inside-email"
                  ? safeEmailSpan(span)
                  : span,
            );
          },
          forceFlush: () => batch.forceFlush(),
          shutdown: () => batch.shutdown(),
        },
      ],
    }));
    const metricExporter: PushMetricExporter = {
      export: (metrics, callback) =>
        configuration.exporters.metrics.export(metrics, (result) => {
          if (result.code !== ExportResultCode.SUCCESS) {
            failedMetricExports++;
            configuration.onExportFailure?.("metrics");
          }
          callback(result);
        }),
      forceFlush: () => configuration.exporters.metrics.forceFlush(),
      shutdown: () => configuration.exporters.metrics.shutdown(),
      ...(configuration.exporters.metrics.selectAggregationTemporality ===
      undefined
        ? {}
        : {
            selectAggregationTemporality:
              configuration.exporters.metrics.selectAggregationTemporality.bind(
                configuration.exporters.metrics,
              ),
          }),
      ...(configuration.exporters.metrics.selectAggregation === undefined
        ? {}
        : {
            selectAggregation:
              configuration.exporters.metrics.selectAggregation.bind(
                configuration.exporters.metrics,
              ),
          }),
    };
    const reader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: EXPORT_INTERVAL_MS,
      exportTimeoutMillis: TELEMETRY_EXPORT_TIMEOUT_MS,
      cardinalityLimits: { default: 128 },
      maxExportBatchSize: 128,
    });
    const meters = (metricRuntime = new MeterProvider({
      resource,
      readers: [reader],
      views: [
        {
          meterName: "pg-boss",
          attributesProcessors: [
            { process: (attributes) => pgBossAttributes(attributes, queues) },
          ],
        },
      ],
    }));
    const meter = meters.getMeter("inside-http");
    const requests = meter.createCounter("http.server.request.count");
    let activeRequests = 0;
    meter
      .createObservableGauge("http.server.active_requests")
      .addCallback((result) => result.observe(activeRequests));
    const duration = meter.createHistogram("http.server.request.duration", {
      unit: "s",
    });
    meter
      .createObservableCounter("telemetry.trace.dropped")
      .addCallback((result) => result.observe(droppedSpans));
    meter
      .createObservableCounter("telemetry.trace.export.failures")
      .addCallback((result) => result.observe(failedTraceExports));
    meter
      .createObservableCounter("telemetry.metric.export.failures")
      .addCallback((result) => result.observe(failedMetricExports));
    meter
      .createObservableGauge("telemetry.trace.sampling.ratio")
      .addCallback((result) => result.observe(configuration.sampleRatio));
    const tracer = traces.getTracer("inside-http");
    const dependencyTracer = traces.getTracer("inside-dependency");
    const dependencyCount = meter.createCounter("inside.dependency.operations");
    const dependencyDuration = meter.createHistogram(
      "inside.dependency.duration",
      { unit: "s" },
    );
    const recordDependency = (
      dependency:
        "kinescope" | "postgresql" | "tbank" | "logto" | "telegram" | "s3",
      operation:
        | KinescopeOperation
        | PostgresOperation
        | TbankOperation
        | "jwks"
        | CommunityOperation
        | TelegramHttpOperation
        | S3Operation
        | "communications.execute"
        | "waitlist.confirm",
      failed: boolean,
      seconds: number,
    ) => {
      const attributes = {
        dependency,
        operation,
        outcome: failed ? "failed" : "completed",
      };
      dependencyCount.add(1, attributes);
      dependencyDuration.record(seconds, attributes);
    };
    const emailTracer = traces.getTracer("inside-email");
    const emailCount = meter.createCounter("inside.email.operations");
    const emailDuration = meter.createHistogram("inside.email.duration", {
      unit: "s",
    });
    const recordEmail = (
      operation: EmailOperation | "smtpSend",
      outcome: EmailOutcome,
      seconds: number,
    ) => {
      const attributes = { operation, outcome };
      emailCount.add(1, attributes);
      emailDuration.record(seconds, attributes);
    };
    const pools = new Map<object, () => PostgresPoolSnapshot>();
    let poolOverflow = false;
    let poolClosed = false;
    const observePool = (owner: object, read: () => PostgresPoolSnapshot) => {
      if (poolClosed) return;
      for (const [key, source] of pools)
        if (!source().available) pools.delete(key);
      if (pools.has(owner) || pools.size < MAX_OBSERVED_POSTGRES_POOLS)
        pools.set(owner, read);
      else poolOverflow = true;
    };
    const poolSnapshot = () =>
      [...pools.values()]
        .map((read) => read())
        .filter((value) => value.available);
    meter
      .createObservableGauge("inside.postgresql.pool.registry_overflow")
      .addCallback((result) => result.observe(poolOverflow ? 1 : 0));
    meter
      .createObservableGauge("inside.postgresql.pool.available")
      .addCallback((result) => {
        result.observe(!poolOverflow && poolSnapshot().length > 0 ? 1 : 0);
      });
    for (const count of ["total", "idle", "waiting"] as const) {
      meter
        .createObservableGauge(`inside.postgresql.pool.${count}`)
        .addCallback((result) => {
          const live = poolSnapshot();
          // Observable aggregation retains old values when a callback omits a point.
          // Emit an explicit placeholder; counts are valid only while available=1.
          result.observe(
            !poolOverflow && live.length > 0
              ? live.reduce((sum, pool) => sum + pool[count], 0)
              : 0,
          );
        });
    }
    const notificationTracer = traces.getTracer("inside-notification");
    const notificationCount = meter.createCounter(
      "inside.notification.operations",
    );
    const notificationDuration = meter.createHistogram(
      "inside.notification.duration",
      { unit: "s" },
    );
    const recordNotification = (
      operation: NotificationOperation,
      failed: boolean,
      seconds: number,
    ) => {
      const attributes = {
        operation,
        outcome: failed ? "failed" : "completed",
      };
      notificationCount.add(1, attributes);
      notificationDuration.record(seconds, attributes);
    };
    const trackingTracer = traces.getTracer("inside-tracking");
    const trackingCount = meter.createCounter("inside.tracking.operations");
    const trackingDuration = meter.createHistogram("inside.tracking.duration", {
      unit: "s",
    });
    const waitlistTracer = traces.getTracer("inside-waitlist");
    const waitlistCount = meter.createCounter("inside.waitlist.operations");
    const waitlistDuration = meter.createHistogram("inside.waitlist.duration", {
      unit: "s",
    });
    let closing: Promise<void> | undefined;
    return {
      pgBoss: (names) => {
        for (const name of names) queues.add(name);
        return {
          enabled: true,
          propagateContext: true,
          propagator: pgBossTracePropagator(),
          tracerProvider: { getTracer: () => traces.getTracer("pg-boss") },
          meterProvider: { getMeter: () => meters.getMeter("pg-boss") },
        };
      },
      runJob: (work) =>
        context.with(
          context
            .active()
            .setValue(
              technicalScopeKey,
              new TechnicalScope(
                identity,
                dependencyTracer,
                recordDependency,
                emailTracer,
                recordEmail,
                observePool,
                notificationTracer,
                recordNotification,
              ),
            ),
          work,
        ),
      runTrackingDelivery: async (parent, work) => {
        // A claimed HTTP outbox row resumes its immutable source, never the pump's ambient context.
        const root = ROOT_CONTEXT.setValue(
          technicalScopeKey,
          new TechnicalScope(
            identity,
            dependencyTracer,
            recordDependency,
            emailTracer,
            recordEmail,
            observePool,
            notificationTracer,
            recordNotification,
          ),
        );
        const valid = notificationTraceparent(parent);
        const causal =
          valid === undefined
            ? root
            : pgBossTracePropagator().extract(
                root,
                { traceparent: valid },
                {
                  keys: () => ["traceparent"],
                  get: (
                    carrier: Readonly<Record<string, string>>,
                    key: string,
                  ) =>
                    key === "traceparent" ? carrier["traceparent"] : undefined,
                },
              );
        const span = trackingTracer.startSpan(
          "tracking deliver",
          {
            kind: SpanKind.INTERNAL,
            attributes: { "tracking.operation": "deliver" },
          },
          causal,
        );
        const started = performance.now();
        let failed = false;
        try {
          return await context.with(trace.setSpan(causal, span), () =>
            work({
              fail: () => {
                failed = true;
              },
            }),
          );
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          const outcome = failed ? "failed" : "completed";
          span.setAttribute("tracking.outcome", outcome);
          if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
          const attributes = { operation: "deliver", outcome };
          trackingCount.add(1, attributes);
          trackingDuration.record(
            (performance.now() - started) / 1_000,
            attributes,
          );
          span.end();
        }
      },
      runWaitlistDelivery: async (parent, work) => {
        // A committed waitlist outbox row resumes its immutable source, never the pump's ambient context.
        const root = ROOT_CONTEXT.setValue(
          technicalScopeKey,
          new TechnicalScope(
            identity,
            dependencyTracer,
            recordDependency,
            emailTracer,
            recordEmail,
            observePool,
            notificationTracer,
            recordNotification,
          ),
        );
        const valid = notificationTraceparent(parent);
        const causal =
          valid === undefined
            ? root
            : pgBossTracePropagator().extract(
                root,
                { traceparent: valid },
                {
                  keys: () => ["traceparent"],
                  get: (
                    carrier: Readonly<Record<string, string>>,
                    key: string,
                  ) =>
                    key === "traceparent" ? carrier["traceparent"] : undefined,
                },
              );
        const span = waitlistTracer.startSpan(
          "waitlist deliver",
          {
            kind: SpanKind.INTERNAL,
            attributes: { "waitlist.operation": "deliver" },
          },
          causal,
        );
        const started = performance.now();
        let failed = false;
        try {
          return await context.with(trace.setSpan(causal, span), () =>
            work({
              fail: () => {
                failed = true;
              },
            }),
          );
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          const outcome = failed ? "failed" : "completed";
          span.setAttribute("waitlist.outcome", outcome);
          if (failed) span.setStatus({ code: SpanStatusCode.ERROR });
          const attributes = { operation: "deliver", outcome };
          waitlistCount.add(1, attributes);
          waitlistDuration.record(
            (performance.now() - started) / 1_000,
            attributes,
          );
          span.end();
        }
      },
      startHttp: (input) => {
        activeRequests++;
        const method = [
          "GET",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "HEAD",
          "OPTIONS",
        ].includes(input.method)
          ? input.method
          : "_OTHER";
        const route = input.route ?? "unmatched";
        const attributes: Attributes = {
          "http.request.method": method,
          "http.route": route,
        };
        const span = tracer.startSpan(
          `${method} ${route}`,
          { kind: SpanKind.SERVER, attributes },
          ROOT_CONTEXT,
        );
        const correlation = {
          ...identity,
          traceId: span.spanContext().traceId,
          spanId: span.spanContext().spanId,
          traceSampled:
            (span.spanContext().traceFlags & TraceFlags.SAMPLED) !== 0,
        };
        let finished = false;
        return {
          run: (work) =>
            context.with(
              trace.setSpan(
                ROOT_CONTEXT.setValue(
                  technicalScopeKey,
                  new TechnicalScope(
                    correlation,
                    dependencyTracer,
                    recordDependency,
                    emailTracer,
                    recordEmail,
                    observePool,
                    notificationTracer,
                    recordNotification,
                  ),
                ),
                span,
              ),
              work,
            ),
          finish: (status, durationMs, outcome = "completed") => {
            if (finished) return;
            finished = true;
            activeRequests--;
            const completed = {
              ...attributes,
              "http.request.outcome": outcome,
              ...(status === undefined
                ? {}
                : { "http.response.status_code": status }),
              ...(outcome === "completed" ? {} : { "error.type": outcome }),
            };
            requests.add(1, completed);
            duration.record(Math.max(0, durationMs) / 1_000, completed);
            span.setAttributes(completed);
            if (
              outcome !== "completed" ||
              (status !== undefined && status >= 500)
            )
              span.setStatus({ code: SpanStatusCode.ERROR });
            span.end();
          },
        };
      },
      correlation: technicalLogCorrelation,
      diagnostics: () => ({
        droppedSpans,
        failedTraceExports,
        failedMetricExports,
      }),
      flush: async () => {
        await Promise.allSettled([traces.forceFlush(), meters.forceFlush()]);
      },
      shutdown: () => {
        if (closing === undefined) {
          poolClosed = true;
          pools.clear();
          closing = Promise.allSettled([
            traces.shutdown(),
            meters.shutdown(),
          ]).then(() => {
            lease.release();
          });
        }
        return closing;
      },
    };
  } catch {
    // Telemetry construction is optional infrastructure; keep application startup independent.
    const cleanup = Promise.allSettled([
      Promise.resolve().then(() =>
        traceRuntime === undefined
          ? configuration.exporters.spans.shutdown()
          : traceRuntime.shutdown(),
      ),
      Promise.resolve().then(() =>
        metricRuntime === undefined
          ? configuration.exporters.metrics.shutdown()
          : metricRuntime.shutdown(),
      ),
    ]).then(() => {
      lease.release();
    });
    configuration.onContextUnavailable?.();
    return {
      ...createTechnicalTelemetry({ enabled: false }),
      shutdown: () => cleanup,
    };
  }
}
