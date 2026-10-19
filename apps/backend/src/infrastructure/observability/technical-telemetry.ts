import {
  context,
  createContextKey,
  trace,
  ROOT_CONTEXT,
  TraceFlags,
  SpanKind,
  SpanStatusCode,
  type Attributes,
} from "@opentelemetry/api";
import type { OpenTelemetryOptions } from "pg-boss";
import {
  pgBossAttributes,
  pgBossTracePropagator,
  safePgBossSpan,
} from "./pg-boss-telemetry.js";
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

const EXPORT_INTERVAL_MS = 5_000;
const technicalScopeKey = createContextKey("inside.technical.scope");
class TechnicalScope {
  constructor(
    readonly correlation: Readonly<Record<string, string | boolean>>,
  ) {}
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

interface EnabledConfiguration {
  readonly enabled: true;
  readonly service:
    "platform-api" | "platform-mcp" | "platform-material-assets-worker";
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
      runJob: (work) => work(),
      startHttp: () => ({ run: (work) => work(), finish: () => undefined }),
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
            .setValue(technicalScopeKey, new TechnicalScope(identity)),
          work,
        ),
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
                  new TechnicalScope(correlation),
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
      shutdown: () =>
        (closing ??= Promise.allSettled([
          traces.shutdown(),
          meters.shutdown(),
        ]).then(() => {
          lease.release();
        })),
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
