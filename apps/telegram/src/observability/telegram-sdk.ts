import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  trace,
  type Context,
  type Span,
} from "@opentelemetry/api";
import { ExportResultCode, parseTraceParent } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BasicTracerProvider,
  TraceIdRatioBasedSampler,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import type { RuntimeIdentity, RuntimeMode } from "@inside/runtime-identity";
import { createBoundedSpanProcessor } from "./bounded-span-processor.js";
import { admitInternalWaitlistParent } from "./internal-waitlist-parent.js";
import { rejectFailures } from "../shared/drain-report.js";
import {
  disabledTelegramObservability,
  type TelegramObservability,
} from "./telegram-observability.js";

const operations = {
  receipt: { name: "waitlist receipt", kind: SpanKind.INTERNAL },
  authorization: { name: "platform waitlist.confirm", kind: SpanKind.CLIENT },
  attempt: { name: "waitlist attempt", kind: SpanKind.INTERNAL },
  sendMessage: { name: "telegram sendMessage", kind: SpanKind.CLIENT },
} as const;
type Operation = keyof typeof operations;
type Outcome =
  | "completed"
  | "failed"
  | "accepted"
  | "suppressed"
  | "unavailable"
  | "delivered"
  | "api_rejected"
  | "api_retryable"
  | "transport_unknown";

function parentContext(parent: string | null | undefined): Context {
  if (
    parent == null ||
    admitInternalWaitlistParent(["traceparent", parent]) === undefined
  )
    return ROOT_CONTEXT;
  const parsed = parseTraceParent(parent);
  return parsed === null
    ? ROOT_CONTEXT
    : trace.setSpanContext(ROOT_CONTEXT, { ...parsed, isRemote: true });
}

function carrier(span: Span | undefined): string | undefined {
  const current = span?.spanContext();
  if (current === undefined) return undefined;
  return `00-${current.traceId}-${current.spanId}-${(current.traceFlags & TraceFlags.SAMPLED) === 0 ? "00" : "01"}`;
}

interface TelegramSdkInput {
  readonly identity: RuntimeIdentity;
  readonly mode: RuntimeMode;
  readonly sampleRatio: number;
  readonly exporters: {
    readonly spans: SpanExporter;
    readonly metrics: PushMetricExporter;
  };
}

function ownShutdown(work: () => Promise<void>) {
  let closing: Promise<void> | undefined;
  return {
    started: () => closing !== undefined,
    close: () => {
      closing ??= Promise.resolve().then(work);
      return closing;
    },
  };
}

interface SdkOwners {
  manager?: AsyncLocalStorageContextManager;
  traces?: BasicTracerProvider;
  reader?: PeriodicExportingMetricReader;
  meters?: MeterProvider;
  readonly spans: ReturnType<typeof ownShutdown>;
  readonly metrics: ReturnType<typeof ownShutdown>;
  metricFailures: number;
}

async function closeOwners(owners: SdkOwners): Promise<void> {
  const failures: unknown[] = [];
  try {
    await owners.traces?.shutdown();
  } catch (error) {
    failures.push(error);
  }
  try {
    if (owners.meters === undefined) await owners.reader?.shutdown();
    else await owners.meters.shutdown();
  } catch (error) {
    failures.push(error);
  }
  // A failing SDK hook may stop before releasing its transport. Retain that independent owner.
  if (!owners.spans.started()) {
    try {
      await owners.spans.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (!owners.metrics.started()) {
    try {
      await owners.metrics.close();
    } catch (error) {
      failures.push(error);
    }
  }
  owners.manager?.disable();
  rejectFailures(failures);
}

/** Standalone SDK ownership. No process-global context, tracer or propagator registration. */
export function createTelegramObservability(
  input: TelegramSdkInput,
): TelegramObservability {
  const owners: SdkOwners = {
    metricFailures: 0,
    spans: ownShutdown(() => input.exporters.spans.shutdown()),
    metrics: ownShutdown(() => input.exporters.metrics.shutdown()),
  };
  try {
    const spans: SpanExporter = {
      export: (batch, callback) =>
        input.exporters.spans.export(batch, callback),
      shutdown: owners.spans.close,
    };
    const source = input.exporters.metrics;
    const metrics: PushMetricExporter = {
      export: (batch, callback) => {
        try {
          source.export(batch, (result) => {
            if (result.code !== ExportResultCode.SUCCESS)
              owners.metricFailures++;
            callback(result);
          });
        } catch {
          owners.metricFailures++;
          callback({ code: ExportResultCode.FAILED });
        }
      },
      forceFlush: () => source.forceFlush(),
      shutdown: owners.metrics.close,
      ...(source.selectAggregationTemporality === undefined
        ? {}
        : {
            selectAggregationTemporality:
              source.selectAggregationTemporality.bind(source),
          }),
      ...(source.selectAggregation === undefined
        ? {}
        : {
            selectAggregation: source.selectAggregation.bind(source),
          }),
    };
    return createOwnedSdk({ ...input, exporters: { spans, metrics } }, owners);
  } catch {
    const cleanup = Promise.allSettled([closeOwners(owners)]);
    let closing: Promise<void> | undefined;
    return {
      ...disabledTelegramObservability,
      shutdown: () => {
        closing ??= cleanup.then((results) =>
          rejectFailures(
            results.flatMap((result): unknown[] =>
              result.status === "rejected" ? [result.reason] : [],
            ),
          ),
        );
        return closing;
      },
    };
  }
}

function createOwnedSdk(
  input: TelegramSdkInput,
  owners: SdkOwners,
): TelegramObservability {
  const manager = (owners.manager =
    new AsyncLocalStorageContextManager().enable());
  const resource = resourceFromAttributes({
    "service.name": "inside-telegram",
    "deployment.environment.name": input.mode,
    "service.version": input.identity.release,
  });
  let dropped = 0;
  let failedExports = 0;
  const processor = createBoundedSpanProcessor(input.exporters.spans, {
    dropped: () => {
      dropped++;
    },
    failed: () => {
      failedExports++;
    },
  });
  const traces = (owners.traces = new BasicTracerProvider({
    resource,
    sampler: new TraceIdRatioBasedSampler(input.sampleRatio),
    spanLimits: {
      attributeCountLimit: 16,
      attributeValueLengthLimit: 160,
      eventCountLimit: 0,
      linkCountLimit: 0,
    },
    spanProcessors: [processor],
  }));
  const reader = (owners.reader = new PeriodicExportingMetricReader({
    exporter: input.exporters.metrics,
    exportIntervalMillis: 5000,
    exportTimeoutMillis: 1000,
    cardinalityLimits: { default: 128 },
    maxExportBatchSize: 128,
  }));
  const meters = (owners.meters = new MeterProvider({
    resource,
    readers: [reader],
  }));
  const meter = meters.getMeter("inside-telegram");
  const count = meter.createCounter("inside.telegram.operations");
  const duration = meter.createHistogram("inside.telegram.duration", {
    unit: "s",
  });
  meter
    .createObservableCounter("telemetry.trace.dropped")
    .addCallback((result) => result.observe(dropped));
  meter
    .createObservableCounter("telemetry.trace.export.failures")
    .addCallback((result) => result.observe(failedExports));
  meter
    .createObservableCounter("telemetry.metric.export.failures")
    .addCallback((result) => result.observe(owners.metricFailures));
  meter
    .createObservableGauge("telemetry.trace.sampling.ratio")
    .addCallback((result) => result.observe(input.sampleRatio));
  const tracer = traces.getTracer("inside-telegram");
  const active = new Set<Promise<void>>();
  let closed = false;
  let closing: Promise<void> | undefined;

  async function observe<Value>(
    operation: Operation,
    parent: Context,
    work: (
      span: Span | undefined,
      complete: (outcome: Outcome) => void,
    ) => Promise<Value>,
  ): Promise<Value> {
    if (closed)
      return manager.with(ROOT_CONTEXT, () => work(undefined, () => undefined));
    const started = performance.now();
    let outcome: Outcome = "completed";
    let span: Span | undefined;
    let settled: (() => void) | undefined;
    let ownership: Promise<void> | undefined;
    if (active.size < 512) {
      ownership = new Promise<void>((resolve) => {
        settled = resolve;
      });
      active.add(ownership);
      span = tracer.startSpan(
        operations[operation].name,
        {
          kind: operations[operation].kind,
          attributes: { "telegram.operation": operation },
        },
        parent,
      );
    } else {
      dropped++;
    }
    try {
      return await manager.with(
        span === undefined ? ROOT_CONTEXT : trace.setSpan(parent, span),
        () =>
          work(span, (value) => {
            outcome = value;
          }),
      );
    } catch (error) {
      outcome = "failed";
      span?.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span?.setAttribute("telegram.outcome", outcome);
      span?.end();
      const attributes = {
        "telegram.operation": operation,
        "telegram.outcome": outcome,
      };
      count.add(1, attributes);
      duration.record((performance.now() - started) / 1000, attributes);
      if (ownership !== undefined) active.delete(ownership);
      settled?.();
    }
  }

  return {
    runReceipt: (parent, work) =>
      observe("receipt", parentContext(parent), (span) =>
        work(
          parent !== undefined &&
            admitInternalWaitlistParent(["traceparent", parent]) !== undefined
            ? (carrier(span) ?? null)
            : null,
        ),
      ),
    runAuthorization: (parent, work) =>
      observe("authorization", parentContext(parent), (span, complete) =>
        work({
          traceparent: () => carrier(span),
          response: (status) => {
            if (Number.isInteger(status) && status >= 100 && status <= 599)
              span?.setAttribute("http.response.status_code", status);
          },
          complete,
        }),
      ),
    runAttempt: (parent, work) =>
      observe("attempt", parentContext(parent), () => work()),
    runBotApi: (work) =>
      observe("sendMessage", manager.active(), async (_span, complete) => {
        const result = await work();
        switch (result.kind) {
          case "delivered":
          case "api_rejected":
          case "api_retryable":
          case "transport_unknown":
            complete(result.kind);
            break;
        }
        return result;
      }),
    shutdown: () => {
      if (closing !== undefined) return closing;
      closed = true;
      closing = Promise.resolve().then(async () => {
        while (active.size !== 0) await Promise.all(active);
        await closeOwners(owners);
      });
      return closing;
    },
  };
}
