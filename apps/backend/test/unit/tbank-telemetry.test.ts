import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  context,
  createContextKey,
  ROOT_CONTEXT,
  SpanKind,
} from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { expect, test } from "vitest";
import { createTechnicalTelemetry } from "../../src/infrastructure/observability/technical-telemetry.js";
import { Tbank } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { localTbankConfig } from "../../src/config/tbank-config.js";

const config = localTbankConfig({});
const payment = {
  TerminalKey: config.terminalKey,
  OrderId: "private-order",
  PaymentId: "private-payment",
  Amount: 100,
  Status: "NEW",
  Success: true,
  ErrorCode: "0",
};

test("a bank state request records one safe completion without requiring response status", async () => {
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
    const bank = new Tbank(config, (_url, init) => {
      requests++;
      expect(init.headers).toEqual({ "content-type": "application/json" });
      expect(init.redirect).toBe("error");
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(payment),
      });
    });
    await expect(
      telemetry.runJob(() => bank.state("private-payment")),
    ).resolves.toEqual(payment);
    await telemetry.flush();
    expect(requests).toBe(1);
    expect(spans.getFinishedSpans()).toHaveLength(1);
    const span = spans.getFinishedSpans()[0];
    expect(span?.kind).toBe(SpanKind.CLIENT);
    expect(span?.name).toBe("tbank GetState");
    expect(span?.attributes).toEqual({
      "dependency.name": "tbank",
      "dependency.operation": "GetState",
      "http.request.method": "POST",
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
          dependency: "tbank",
          operation: "GetState",
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

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function runtime(sampleRatio = 1) {
  const spans = new InMemorySpanExporter();
  const metrics = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "proof",
    sampleRatio,
    exporters: { spans, metrics },
  });
  return { spans, metrics, telemetry };
}

test("all seven admitted bank operations count actual requests and local refusals do not", async () => {
  const { spans, telemetry } = runtime();
  try {
    const methods: string[] = [];
    const bank = new Tbank(config, (url) => {
      const method = url.split("/").at(-1);
      if (method === undefined) throw new Error("missing method");
      methods.push(method);
      const result =
        method === "CheckOrder"
          ? {
              TerminalKey: config.terminalKey,
              OrderId: "private-order",
              Success: true,
              ErrorCode: "0",
              Payments: [],
            }
          : method === "AddCard"
            ? {
                TerminalKey: config.terminalKey,
                Success: true,
                ErrorCode: "0",
                RequestKey: "private-session",
                PaymentURL: "http://127.0.0.1:8090/form",
              }
            : method === "GetAddCardState"
              ? {
                  TerminalKey: config.terminalKey,
                  RequestKey: "private-session",
                  Status: "NEW",
                  Success: true,
                  ErrorCode: "0",
                }
              : { ...payment, PaymentURL: "http://127.0.0.1:8090/form" };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(result) });
    });
    await telemetry.runJob(async () => {
      await expect(
        bank.init({
          orderId: "private-order",
          accountId: "private-account",
          amount: 100,
          name: "private-title",
          email: "private-email@example.test",
          returnPath: "https://untrusted.example.test",
        }),
      ).rejects.toThrow("Invalid purchase return path");
      const noBinding = new Tbank({ ...config, cardBinding: undefined }, () =>
        Promise.reject(new Error("must not request")),
      );
      await expect(noBinding.addCard("private-account")).rejects.toThrow(
        "Card binding",
      );
      await bank.init({
        orderId: "private-order",
        accountId: "private-account",
        amount: 100,
        name: "private-title",
        email: "private-email@example.test",
      });
      await bank.state("private-payment");
      await bank.order("private-order");
      await bank.charge({
        paymentId: "private-payment",
        rebillId: "private-binding",
      });
      await bank.cancel({
        paymentId: "private-payment",
        amount: 100,
        externalRequestId: "private-refund",
        name: "private-name",
        email: "private-email@example.test",
      });
      await bank.addCard("private-account");
      await bank.addCardState("private-session");
      expect(bank.notification({})).toBeUndefined();
    });
    await telemetry.flush();
    expect(methods).toEqual([
      "Init",
      "GetState",
      "CheckOrder",
      "Charge",
      "Cancel",
      "AddCard",
      "GetAddCardState",
    ]);
    expect(spans.getFinishedSpans().map((span) => span.name)).toEqual([
      "tbank Init",
      "tbank GetState",
      "tbank CheckOrder",
      "tbank Charge",
      "tbank Cancel",
      "tbank AddCard",
      "tbank GetAddCardState",
    ]);
    expect(
      spans
        .getFinishedSpans()
        .every((span) => span.attributes["dependency.outcome"] === "completed"),
    ).toBe(true);
  } finally {
    await telemetry.shutdown();
  }
});

test("bank request completion awaits existing JSON read and concurrent parents are restored", async () => {
  const { spans, telemetry } = runtime();
  try {
    const body = deferred<unknown>();
    const reading = deferred<undefined>();
    const bank = new Tbank(config, () =>
      Promise.resolve({
        ok: true,
        json: () => {
          reading.resolve(undefined);
          return body.promise;
        },
      }),
    );
    const first = telemetry.startHttp({
      method: "POST",
      route: "/billing/subscriptions/purchase",
    });
    const second = telemetry.startHttp({
      method: "GET",
      route: "/billing/payments/:purchaseRef",
    });
    const firstParent = first.run(() => telemetry.correlation()["spanId"]);
    const secondParent = second.run(() => telemetry.correlation()["spanId"]);
    const pending = first.run(async () => {
      const result = await bank.state("private-payment");
      expect(telemetry.correlation()["spanId"]).toBe(firstParent);
      return result;
    });
    await reading.promise;
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toEqual([]);
    await second.run(async () => {
      await new Tbank(config, () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(payment),
        }),
      ).charge({ paymentId: "private-payment", rebillId: "private-rebill" });
      expect(telemetry.correlation()["spanId"]).toBe(secondParent);
    });
    body.resolve(payment);
    await expect(pending).resolves.toEqual(payment);
    first.finish(200, 1);
    second.finish(200, 1);
    await telemetry.flush();
    expect(
      spans
        .getFinishedSpans()
        .filter((span) => span.kind === SpanKind.CLIENT)
        .map((span) => [span.name, span.parentSpanContext?.spanId]),
    ).toEqual([
      ["tbank Charge", secondParent],
      ["tbank GetState", firstParent],
    ]);
    expect(telemetry.correlation()).toEqual({});
  } finally {
    await telemetry.shutdown();
  }
});

test("transport and JSON errors preserve object identity and later domain rejection is outside request outcome", async () => {
  const { spans, metrics, telemetry } = runtime();
  try {
    const original = new TypeError("private-transport-error", {
      cause: "private-cause",
    });
    const jsonError = new SyntaxError("private-json-error");
    let reads = 0;
    await telemetry.runJob(async () => {
      await expect(
        new Tbank(config, () => Promise.reject(original)).state(
          "private-payment",
        ),
      ).rejects.toBe(original);
      await expect(
        new Tbank(config, () =>
          Promise.resolve({
            ok: true,
            json: () => Promise.reject(jsonError),
          }),
        ).state("private-payment"),
      ).rejects.toBe(jsonError);
      await expect(
        new Tbank(config, () =>
          Promise.resolve({
            ok: false,
            json: () => {
              reads++;
              return Promise.resolve(payment);
            },
          }),
        ).state("private-payment"),
      ).rejects.toThrow("Bank response unavailable");
      await expect(
        new Tbank(config, () =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ private: "private-response" }),
          }),
        ).state("private-payment"),
      ).rejects.toThrow();
    });
    await telemetry.flush();
    expect(reads).toBe(0);
    expect(
      spans
        .getFinishedSpans()
        .map((span) => span.attributes["dependency.outcome"]),
    ).toEqual(["failed", "failed", "failed", "completed"]);
    expect(
      spans.getFinishedSpans().every((span) => span.events.length === 0),
    ).toBe(true);
    expect(
      JSON.stringify({
        spans: spans.getFinishedSpans().map((span) => ({
          name: span.name,
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
});

test("default OFF and nested OFF suppress bank capture while zero sampling retains counts", async () => {
  const { spans, metrics, telemetry } = runtime(0);
  const off = createTechnicalTelemetry({ enabled: false });
  const bank = new Tbank(config, () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payment),
    }),
  );
  try {
    await bank.state("private-unscoped");
    await telemetry.runJob(() => off.runJob(() => bank.state("private-off")));
    await telemetry.flush();
    expect(
      metrics
        .getMetrics()
        .flatMap((resource) =>
          resource.scopeMetrics.flatMap((scope) => scope.metrics),
        )
        .some(
          (metric) => metric.descriptor.name === "inside.dependency.operations",
        ),
    ).toBe(false);
    await telemetry.runJob(() => bank.state("private-on"));
    await telemetry.flush();
    expect(spans.getFinishedSpans()).toEqual([]);
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
          dependency: "tbank",
          operation: "GetState",
          outcome: "completed",
        },
        value: 1,
      },
    ]);
  } finally {
    await off.shutdown();
    await telemetry.shutdown();
  }
});

test("refused bank telemetry preserves the foreign context manager", async () => {
  const foreign = new AsyncLocalStorageContextManager().enable();
  let registered = false;
  let telemetry: ReturnType<typeof createTechnicalTelemetry> | undefined;
  try {
    registered = context.setGlobalContextManager(foreign);
    expect(registered).toBe(true);
    const candidate = runtime();
    telemetry = candidate.telemetry;
    const marker = createContextKey("bank foreign owner");
    const bank = new Tbank(config, () =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(payment),
      }),
    );
    await foreign.with(ROOT_CONTEXT.setValue(marker, "preserved"), () =>
      candidate.telemetry.runJob(async () => {
        await bank.state("private-payment");
        expect(context.active().getValue(marker)).toBe("preserved");
      }),
    );
    await telemetry.flush();
    expect(candidate.spans.getFinishedSpans()).toEqual([]);
    await telemetry.shutdown();
    foreign.with(ROOT_CONTEXT.setValue(marker, "preserved"), () =>
      expect(context.active().getValue(marker)).toBe("preserved"),
    );
  } finally {
    await telemetry?.shutdown();
    if (registered) context.disable();
    else foreign.disable();
  }
});

test("repeated bank runtime lifetimes retain the surviving context lease", async () => {
  const bank = new Tbank(config, () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payment),
    }),
  );
  for (let index = 0; index < 3; index++) {
    const first = runtime();
    const second = runtime();
    try {
      await first.telemetry.runJob(() => bank.state("private-first"));
      await first.telemetry.shutdown();
      await second.telemetry.runJob(() => bank.state("private-second"));
      await second.telemetry.flush();
      expect(second.spans.getFinishedSpans().map((span) => span.name)).toEqual([
        "tbank GetState",
      ]);
      expect(second.telemetry.correlation()).toEqual({});
    } finally {
      await first.telemetry.shutdown();
      await second.telemetry.shutdown();
    }
  }
});
