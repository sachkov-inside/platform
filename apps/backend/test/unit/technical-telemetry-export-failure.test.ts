import { ExportResultCode, type ExportResult } from "@opentelemetry/core";
import {
  InMemoryMetricExporter,
  AggregationTemporality,
} from "@opentelemetry/sdk-metrics";
import { describe, expect, it } from "vitest";
import {
  createTechnicalTelemetry,
  type ExportFailureObservation,
} from "../../src/infrastructure/observability/technical-telemetry.js";

async function observe(
  error: Error | undefined,
  observer?: (failure: ExportFailureObservation) => void,
) {
  const observations: ExportFailureObservation[] = [];
  const telemetry = createTechnicalTelemetry({
    enabled: true,
    service: "platform-api",
    environment: "test",
    release: "test",
    sampleRatio: 1,
    onExportFailure: (_signal, failure) => {
      observations.push(failure);
      observer?.(failure);
    },
    exporters: {
      spans: {
        export: (_batch, callback) =>
          callback(
            error === undefined
              ? { code: ExportResultCode.FAILED }
              : { code: ExportResultCode.FAILED, error },
          ),
        shutdown: () => Promise.resolve(),
      },
      metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    },
  });
  try {
    telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
    await telemetry.flush();
    expect(telemetry.diagnostics()).toEqual({
      droppedSpans: 0,
      failedTraceExports: 1,
      failedMetricExports: 0,
    });
    return observations;
  } finally {
    await telemetry.shutdown();
  }
}

describe("closed real exporter callback observation", () => {
  it("retains only pinned failure categories without invoking Error getters", async () => {
    let touched = 0;
    const getterError = new Error();
    Object.defineProperty(getterError, "message", {
      get: () => {
        touched++;
        throw Error("private-sentinel");
      },
    });
    const getterCode = new Error();
    Object.defineProperty(getterCode, "code", {
      get: () => {
        touched++;
        throw Error("private-sentinel");
      },
    });
    const proxy = new Proxy(new Error("private-sentinel"), {
      get: () => {
        touched++;
        throw Error("private-sentinel");
      },
      getOwnPropertyDescriptor: () => {
        touched++;
        throw Error("private-sentinel");
      },
    });
    const revoked = Proxy.revocable(new Error("private-sentinel"), {});
    revoked.revoke();
    const http = Object.assign(new Error("private-response"), {
      name: "OTLPExporterError",
      code: 400,
      data: "private-body",
    });
    const values: {
      error: Error | undefined;
      kind: ExportFailureObservation["kind"];
      code?: number | string;
    }[] = [
      { error: http, kind: "http", code: 400 },
      {
        error: Object.assign(new Error("private-address"), {
          code: "ECONNRESET",
          address: "private-host",
        }),
        kind: "network",
        code: "ECONNRESET",
      },
      { error: new Error("Request timed out"), kind: "timeout" },
      { error: new Error("Concurrent export limit reached"), kind: "queue" },
      ...[
        undefined,
        {
          name: "OTLPExporterError",
          message: "private-plain-spoof",
          code: 400,
        },
        new Error("private-sentinel"),
        getterError,
        getterCode,
        proxy,
        revoked.proxy,
        Object.assign(new Error("Request timed out"), { code: "private" }),
        Object.assign(new Error("private"), {
          name: "OTLPExporterError",
          code: "400",
        }),
      ].map((error) => ({ error, kind: "unknown" as const })),
    ];
    for (const { error, kind, code } of values) {
      const before = touched;
      const [row] = await observe(error, () => expect(touched).toBe(before));
      expect(row?.kind).toBe(kind);
      expect(row?.elapsedMs).toBeTypeOf("number");
      expect(Object.keys(row ?? {}).sort()).toEqual(
        (code === undefined
          ? ["kind", "elapsedMs"]
          : ["kind", "code", "elapsedMs"]
        ).sort(),
      );
      if (row?.kind === "http" || row?.kind === "network")
        expect(row.code).toBe(code);
      expect(JSON.stringify(row)).not.toContain("private");
    }
  });

  it("isolates a throwing observer and forwards the exact SDK result once", async () => {
    const result: ExportResult = { code: ExportResultCode.FAILED };
    let consumed = 0;
    Object.defineProperty(result, "error", {
      get() {
        expect(this).toBe(result);
        consumed++;
        return new Error("SDK-only-error");
      },
    });
    const telemetry = createTechnicalTelemetry({
      enabled: true,
      service: "platform-api",
      environment: "test",
      release: "test",
      sampleRatio: 1,
      onExportFailure: () => {
        throw Error("diagnostic-only");
      },
      exporters: {
        spans: {
          export: (_batch, callback) => callback(result),
          shutdown: () => Promise.resolve(),
        },
        metrics: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      },
    });
    try {
      telemetry.startHttp({ method: "GET", route: "/health" }).finish(200, 1);
      await telemetry.flush();
      // Pinned SDK2.12 reads error twice in its single callback (finishSpans and reject).
      // Both reads retain the original receiver; the observer reads only own data descriptors.
      expect(consumed).toBe(2);
      expect(telemetry.diagnostics()).toEqual({
        droppedSpans: 0,
        failedTraceExports: 1,
        failedMetricExports: 0,
      });
    } finally {
      await telemetry.shutdown();
    }
  });
});
