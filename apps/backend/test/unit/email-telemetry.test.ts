import { SpanKind, trace, context } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test } from "vitest";
import {
  createTechnicalTelemetry,
  observeEmailNotification,
  observeSmtpSend,
} from "../../src/infrastructure/observability/technical-telemetry.js";

test("email dispatch restores its durable parent and counts an uncertain SMTP invocation separately from delivery", async () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans, metrics },
  });
  try {
    const outcome = { state: "unknown" as const };
    await telemetry.runJob(() =>
      observeEmailNotification(
        "dispatchMaterial",
        "00-11111111111111111111111111111111-2222222222222222-01",
        async (parent) => {
          expect(parent).toMatch(/^00-11111111111111111111111111111111-/);
          trace
            .getSpan(context.active())
            ?.setAttribute("user.email", "private-raw-email-sentinel");
          trace
            .getSpan(context.active())
            ?.setStatus({ code: 1, message: "private-status-sentinel" });
          return expect(
            observeSmtpSend(() => Promise.resolve(outcome)),
          ).resolves.toBe(outcome);
        },
      ),
    );
    await telemetry.flush();
    const dispatch = spans
      .getFinishedSpans()
      .find((span) => span.name === "dispatch emailMaterial");
    const smtp = spans
      .getFinishedSpans()
      .find((span) => span.name === "smtp send");
    expect(dispatch?.parentSpanContext?.spanId).toBe("2222222222222222");
    expect(dispatch?.attributes["user.email"]).toBeUndefined();
    expect(dispatch?.status).toEqual({ code: 0 });
    expect(smtp?.kind).toBe(SpanKind.CLIENT);
    expect(smtp?.parentSpanContext?.spanId).toBe(
      dispatch?.spanContext().spanId,
    );
    expect(smtp?.attributes).toEqual({
      "dependency.name": "smtp",
      "dependency.operation": "send",
      "dependency.outcome": "unknown",
    });
    const operations = metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .find((metric) => metric.descriptor.name === "inside.email.operations");
    expect(operations?.dataPoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attributes: { operation: "dispatchMaterial", outcome: "completed" },
          value: 1,
        }),
        expect.objectContaining({
          attributes: { operation: "smtpSend", outcome: "unknown" },
          value: 1,
        }),
      ]),
    );
  } finally {
    await telemetry.shutdown();
  }
});

test("email legacy NULL never captures an ambient parent and errors retain identity without private details", async () => {
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: {
      spans,
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  const disabled = createTechnicalTelemetry({ enabled: false });
  try {
    const unrelated = telemetry.startHttp({
      method: "GET",
      route: "/unrelated",
    });
    const error = new Error("private-email-subject-error", {
      cause: new Error("private-password-error"),
    });
    await expect(
      unrelated.run(() =>
        observeEmailNotification("dispatchSubscription", null, (carrier) => {
          expect(carrier).toBeUndefined();
          return Promise.reject(error);
        }),
      ),
    ).rejects.toBe(error);
    await unrelated.run(() =>
      disabled.runJob(() =>
        observeEmailNotification(
          "receiveResult",
          "00-11111111111111111111111111111111-2222222222222222-01",
          (carrier) => {
            expect(carrier).toBeUndefined();
            return observeSmtpSend(() =>
              Promise.resolve({ state: "sent" as const }),
            );
          },
        ),
      ),
    );
    unrelated.finish(200, 1);
    await telemetry.flush();
    const dispatch = spans
      .getFinishedSpans()
      .find((span) => span.name === "dispatch emailSubscription");
    expect(dispatch?.parentSpanContext).toBeUndefined();
    expect(dispatch?.events).toEqual([]);
    expect(dispatch?.attributes).toEqual({
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "inside.notifications.email.v1",
      "messaging.operation.name": "dispatch",
      "email.lane": "emailSubscription",
      "error.type": "email_operation_failed",
    });
    expect(spans.getFinishedSpans()).toHaveLength(2);
    expect(JSON.stringify(dispatch?.attributes)).not.toContain("private-");
  } finally {
    await disabled.shutdown();
    await telemetry.shutdown();
  }
});

test("SMTP outcomes remain distinct counters with zero trace sampling and skipped sends add nothing", async () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "proof",
    sampleRatio: 0,
    exporters: { spans, metrics },
  });
  try {
    await telemetry.runJob(async () => {
      await observeEmailNotification("dispatchMaterial", null, () =>
        Promise.resolve(),
      );
      for (const state of ["sent", "not_sent", "failed", "unknown"] as const)
        await observeSmtpSend(() => Promise.resolve({ state }));
    });
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toEqual([]);
    const operations = metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .find((metric) => metric.descriptor.name === "inside.email.operations");
    expect(operations?.dataPoints).toHaveLength(5);
    for (const state of ["sent", "not_sent", "failed", "unknown"])
      expect(operations?.dataPoints).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attributes: { operation: "smtpSend", outcome: state },
            value: 1,
          }),
        ]),
      );
  } finally {
    await telemetry.shutdown();
  }
});

test("email catalog has twenty-two legitimate metric labelsets with the pinned histogram boundary contract", async () => {
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "proof",
    sampleRatio: 0,
    exporters: { spans: new InMemorySpanExporter(), metrics },
  });
  try {
    await telemetry.runJob(async () => {
      for (const operation of [
        "publishMaterial",
        "receiveMaterial",
        "dispatchMaterial",
        "publishSubscription",
        "receiveSubscription",
        "dispatchSubscription",
        "publishResult",
        "receiveResult",
        "projectResult",
      ] as const) {
        await observeEmailNotification(operation, null, () =>
          Promise.resolve(),
        );
        const error = new Error("private-provider-reply");
        await expect(
          observeEmailNotification(operation, null, () =>
            Promise.reject(error),
          ),
        ).rejects.toBe(error);
      }
      for (const state of ["sent", "not_sent", "failed", "unknown"] as const)
        await observeSmtpSend(() => Promise.resolve({ state }));
    });
    await telemetry.flush();
    const all = metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      );
    const counter = all.find(
      (metric) => metric.descriptor.name === "inside.email.operations",
    );
    const duration = all.find(
      (metric) => metric.descriptor.name === "inside.email.duration",
    );
    expect(counter?.dataPoints).toHaveLength(22);
    expect(duration?.dataPoints).toHaveLength(22);
    for (const point of counter?.dataPoints ?? []) expect(point.value).toBe(1);
    for (const point of duration?.dataPoints ?? [])
      expect(point.value).toMatchObject({
        count: 1,
        buckets: {
          boundaries: [
            0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500,
            10000,
          ],
        },
      });
  } finally {
    await telemetry.shutdown();
  }
});

test("SMTP telemetry bounds malformed outcomes before aggregation and preserves a rejected sender error", async () => {
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const spans = new InMemorySpanExporter();
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-notifications-worker",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans, metrics },
  });
  try {
    const malformed = { state: "sent" as const };
    // Deliberate runtime port corruption; the observer must bound it without rewriting its result.
    Reflect.set(malformed, "state", "private-provider-sentinel");
    const failure = new Error("private-auth-sentinel");
    await telemetry.runJob(async () => {
      await expect(
        observeSmtpSend(() => Promise.resolve(malformed)),
      ).resolves.toBe(malformed);
      await expect(observeSmtpSend(() => Promise.reject(failure))).rejects.toBe(
        failure,
      );
    });
    await telemetry.flush();
    const operations = metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .find((metric) => metric.descriptor.name === "inside.email.operations");
    expect(operations?.dataPoints).toMatchObject([
      { attributes: { operation: "smtpSend", outcome: "unknown" }, value: 2 },
    ]);
    const attributes = spans.getFinishedSpans().map((span) => span.attributes);
    expect(attributes).toEqual([
      {
        "dependency.name": "smtp",
        "dependency.operation": "send",
        "dependency.outcome": "unknown",
      },
      {
        "dependency.name": "smtp",
        "dependency.operation": "send",
        "dependency.outcome": "unknown",
      },
    ]);
    expect(JSON.stringify({ operations, attributes })).not.toContain(
      "private-",
    );
  } finally {
    await telemetry.shutdown();
  }
});
