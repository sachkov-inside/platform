import { context, SpanKind } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test, vi } from "vitest";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { HttpCommunicationsProvider } from "../../src/modules/communications/infrastructure/http-communications-provider.js";
import { parsePlatformConfig } from "../../src/config/platform-config.js";
import { requestSchema } from "../../src/modules/communications/communications-schema.generated.js";

const config = parsePlatformConfig({
  NODE_ENV: "test",
  TELEGRAM_COMMUNICATIONS_ENDPOINT:
    "http://127.0.0.1:9876/integrations/platform/v1/communications",
  TELEGRAM_COMMUNICATIONS_SECRET: "private-communications-secret",
  TELEGRAM_AUTHOR_AUTHORIZATION_SECRET: "private-authorization-secret",
  TELEGRAM_COMMUNICATIONS_BOT_IDENTITY: "private-bot",
}).communications;
const request = requestSchema.parse({
  contractVersion: "inside-communications-v1",
  operation: "templates.read",
  operationId: "11111111-1111-4111-8111-111111111111",
  expectedRevision: 0,
  actor: { accountRef: "private-owner" },
  payload: { templateId: "22222222-2222-4222-8222-222222222222" },
});
const success = {
  contractVersion: "inside-communications-v1",
  status: "ok",
  template: {
    templateId: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    botIdentity: "private-bot",
    content: {
      type: "text",
      text: "private-content",
      entities: [],
      buttons: [],
    },
  },
};

test("a configured communications request records one safe request and JSON completion", async () => {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio: 1,
    exporters: { spans, metrics },
  });
  try {
    let requests = 0;
    const provider = new HttpCommunicationsProvider(config, (_url, init) => {
      requests++;
      expect(init?.body).toBe(JSON.stringify(request));
      expect(init?.headers).toEqual({
        authorization: "Bearer private-communications-secret",
        "content-type": "application/json",
      });
      expect(init?.redirect).toBe("error");
      return Promise.resolve(Response.json(success));
    });
    await expect(
      telemetry.runJob(() => provider.execute(request)),
    ).resolves.toEqual({ ok: true, value: success });
    await telemetry.flush();
    expect(requests).toBe(1);
    expect(spans.getFinishedSpans()).toHaveLength(1);
    const span = spans.getFinishedSpans()[0];
    expect(span?.kind).toBe(SpanKind.CLIENT);
    expect(span?.attributes).toEqual({
      "dependency.name": "telegram",
      "dependency.operation": "communications.execute",
      "http.request.method": "POST",
      "http.response.status_code": 200,
      "dependency.outcome": "completed",
    });
    const count = metrics
      .getMetrics()
      .flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) => scope.metrics),
      )
      .find(
        (metric) => metric.descriptor.name === "inside.dependency.operations",
      );
    expect(count?.dataPoints).toMatchObject([
      {
        attributes: {
          dependency: "telegram",
          operation: "communications.execute",
          outcome: "completed",
        },
        value: 1,
      },
    ]);
    expect(
      JSON.stringify({
        attributes: span?.attributes,
        events: span?.events,
        metrics: metrics.getMetrics(),
      }),
    ).not.toContain("private-");
  } finally {
    await telemetry.shutdown();
  }
});

function runtime(enabled = true, sampleRatio = 1) {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio,
    exporters: { spans, metrics },
  });
  return { spans, metrics, telemetry };
}
function counts(metrics: InMemoryMetricExporter) {
  return metrics
    .getMetrics()
    .flatMap((resource) =>
      resource.scopeMetrics.flatMap((scope) => scope.metrics),
    )
    .find((metric) => metric.descriptor.name === "inside.dependency.operations")
    ?.dataPoints;
}
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("body completion ends the request before unchanged domain validation", async () => {
  const { telemetry, spans } = runtime();
  const body = deferred<unknown>();
  const reading = deferred<undefined>();
  try {
    const response = Response.json(success);
    vi.spyOn(response, "json").mockImplementation(() => {
      reading.resolve(undefined);
      return body.promise;
    });
    const provider = new HttpCommunicationsProvider(config, () =>
      Promise.resolve(response),
    );
    const result = telemetry.runJob(() => provider.execute(request));
    await reading.promise;
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toHaveLength(0);
    body.resolve({ status: "invalid", private: "private-body" });
    await expect(result).resolves.toEqual({
      ok: false,
      error: { code: "provider_invalid_response" },
    });
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toHaveLength(1);
    expect(spans.getFinishedSpans()[0]?.attributes["dependency.outcome"]).toBe(
      "completed",
    );
    expect(response.json).toHaveBeenCalledTimes(1);
  } finally {
    body.resolve(success);
    await telemetry.shutdown();
  }
});

test.each(["transport", "body", "http"] as const)(
  "%s failure preserves mapped outcome and never resends",
  async (failure) => {
    const { telemetry, spans, metrics } = runtime();
    try {
      let attempts = 0;
      const error = new Error("private-native-error");
      const provider = new HttpCommunicationsProvider(config, () => {
        attempts++;
        if (failure === "transport") return Promise.reject(error);
        const response =
          failure === "http"
            ? Response.json(
                {
                  contractVersion: "inside-communications-v1",
                  status: "authorization_unavailable",
                },
                { status: 503 },
              )
            : Response.json(success);
        if (failure === "body")
          vi.spyOn(response, "json").mockRejectedValue(error);
        return Promise.resolve(response);
      });
      await expect(
        telemetry.runJob(() => provider.execute(request)),
      ).resolves.toEqual({
        ok: false,
        error: {
          code:
            failure === "http"
              ? "authorization_unavailable"
              : "provider_unavailable",
        },
      });
      await telemetry.flush();
      expect(attempts).toBe(1);
      expect(spans.getFinishedSpans()).toHaveLength(1);
      expect(
        spans.getFinishedSpans()[0]?.attributes["dependency.outcome"],
      ).toBe("failed");
      expect(counts(metrics)).toMatchObject([
        {
          attributes: {
            dependency: "telegram",
            operation: "communications.execute",
            outcome: "failed",
          },
          value: 1,
        },
      ]);
      expect(
        JSON.stringify({
          spans: spans.getFinishedSpans().map((span) => ({
            attributes: span.attributes,
            events: span.events,
            status: span.status,
          })),
          metrics: metrics.getMetrics(),
        }),
      ).not.toContain("private-");
    } finally {
      await telemetry.shutdown();
    }
  },
);

test("absent configuration performs no I/O or dependency observation", async () => {
  const { telemetry, spans, metrics } = runtime();
  try {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      telemetry.runJob(() =>
        new HttpCommunicationsProvider(undefined, fetcher).execute(request),
      ),
    ).resolves.toEqual({ ok: false, error: { code: "provider_unavailable" } });
    await telemetry.flush();
    expect(fetcher).not.toHaveBeenCalled();
    expect(spans.getFinishedSpans()).toHaveLength(0);
    expect(counts(metrics)).toBeUndefined();
  } finally {
    await telemetry.shutdown();
  }
});

test("completion counters remain available with trace sampling zero", async () => {
  const { telemetry, spans, metrics } = runtime(true, 0);
  try {
    await telemetry.runJob(() =>
      new HttpCommunicationsProvider(config, () =>
        Promise.resolve(Response.json(success)),
      ).execute(request),
    );
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toHaveLength(0);
    expect(counts(metrics)).toMatchObject([{ value: 1 }]);
  } finally {
    await telemetry.shutdown();
  }
});

test("disabled scope masks an outer enabled scope and restores its parent", async () => {
  const outer = runtime();
  const disabled = runtime(false);
  try {
    const provider = new HttpCommunicationsProvider(config, () =>
      Promise.resolve(Response.json(success)),
    );
    await outer.telemetry.runJob(async () => {
      const before = context.active();
      await disabled.telemetry.runJob(() => provider.execute(request));
      expect(context.active()).toBe(before);
    });
    await outer.telemetry.flush();
    expect(outer.spans.getFinishedSpans()).toHaveLength(0);
  } finally {
    await disabled.telemetry.shutdown();
    await outer.telemetry.shutdown();
  }
});

test("concurrent HTTP parents remain isolated until the existing body read completes", async () => {
  const { telemetry, spans } = runtime();
  const firstBody = deferred<unknown>();
  const secondBody = deferred<unknown>();
  const firstRead = deferred<undefined>();
  const secondRead = deferred<undefined>();
  const first = telemetry.startHttp({
    method: "POST",
    route: "/communications",
  });
  const second = telemetry.startHttp({
    method: "POST",
    route: "/communications",
  });
  try {
    function pending(
      body: ReturnType<typeof deferred<unknown>>,
      reading: ReturnType<typeof deferred<undefined>>,
    ) {
      const response = Response.json(success);
      vi.spyOn(response, "json").mockImplementation(() => {
        reading.resolve(undefined);
        return body.promise;
      });
      return new HttpCommunicationsProvider(config, () =>
        Promise.resolve(response),
      );
    }
    const one = first.run(() => pending(firstBody, firstRead).execute(request));
    const two = second.run(() =>
      pending(secondBody, secondRead).execute(request),
    );
    await Promise.all([firstRead.promise, secondRead.promise]);
    secondBody.resolve(success);
    await two;
    second.finish(200, 1);
    firstBody.resolve(success);
    await one;
    first.finish(200, 1);
    await telemetry.flush();
    const all = spans.getFinishedSpans();
    const parents = all
      .filter((span) => span.kind === SpanKind.SERVER)
      .map((span) => span.spanContext().spanId)
      .sort();
    const actual = all
      .filter((span) => span.kind === SpanKind.CLIENT)
      .map((span) => span.parentSpanContext?.spanId)
      .sort();
    expect(parents).toHaveLength(2);
    expect(actual).toEqual(parents);
  } finally {
    firstBody.resolve(success);
    secondBody.resolve(success);
    first.finish(200, 1);
    second.finish(200, 1);
    await telemetry.shutdown();
  }
});

test("local serialization refusal is not counted as a provider request", async (owner) => {
  const { telemetry, spans, metrics } = runtime();
  try {
    const fetcher = vi.fn<typeof fetch>();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    owner.onTestFinished(() => {
      timeout.mockRestore();
    });
    let timeoutBeforeSerialization = false;
    const invalid = {
      ...request,
      toJSON() {
        timeoutBeforeSerialization =
          timeout.mock.calls.length === 1 &&
          timeout.mock.calls[0]?.[0] === 5000;
        throw new TypeError("synthetic serialization refusal");
      },
    };
    await expect(
      telemetry.runJob(() =>
        new HttpCommunicationsProvider(config, fetcher).execute(invalid),
      ),
    ).resolves.toEqual({ ok: false, error: { code: "provider_unavailable" } });
    await telemetry.flush();
    expect(timeoutBeforeSerialization).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(spans.getFinishedSpans()).toHaveLength(0);
    expect(counts(metrics)).toBeUndefined();
  } finally {
    await telemetry.shutdown();
  }
});
