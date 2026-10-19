import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { z } from "zod";

import type { RuntimeIdentity } from "../runtime-identity.js";
import { writeLog } from "./log.js";
import {
  createTechnicalTelemetry,
  type TechnicalTelemetry,
} from "./technical-telemetry.js";

import { TELEMETRY_EXPORT_TIMEOUT_MS } from "./technical-telemetry-policy.js";

const runtimeSchema = z.object({
  INSIDE_OTEL_ENDPOINT: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  }),
  INSIDE_OTEL_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(1),
});

/** Opt-in only. Invalid telemetry configuration cannot stop the application. */
export function technicalTelemetryFromEnvironment(input: {
  readonly environment: NodeJS.ProcessEnv;
  readonly service: "platform-api" | "platform-mcp";
  readonly mode: "development" | "test" | "production";
  readonly identity: RuntimeIdentity;
}): TechnicalTelemetry {
  if (input.environment["INSIDE_OTEL_ENABLED"] !== "true")
    return createTechnicalTelemetry({ enabled: false });
  // Pinned exporters read process.env even with an explicit endpoint and merge ambient headers.
  // Refuse their entire transport namespace before construction, including client certificate files.
  if (
    Object.keys(process.env).some((key) => key.startsWith("OTEL_EXPORTER_OTLP"))
  ) {
    writeLog("warn", "telemetry_ambient_configuration_unsupported", {
      service: input.service,
    });
    return createTechnicalTelemetry({ enabled: false });
  }
  const parsed = runtimeSchema.safeParse(input.environment);
  if (!parsed.success) {
    writeLog("warn", "telemetry_configuration_invalid", {
      service: input.service,
    });
    return createTechnicalTelemetry({ enabled: false });
  }
  const endpoint = parsed.data.INSIDE_OTEL_ENDPOINT.replace(/\/$/u, "");
  return createTechnicalTelemetry({
    enabled: true,
    service: input.service,
    environment: input.mode,
    release: input.identity.release,
    sampleRatio: parsed.data.INSIDE_OTEL_SAMPLE_RATIO,
    onContextUnavailable: () =>
      writeLog("warn", "telemetry_context_unavailable", {
        service: input.service,
      }),
    onExportFailure: (signal) =>
      writeLog("warn", "telemetry_export_failed", {
        signal,
        service: input.service,
      }),
    exporters: {
      spans: new OTLPTraceExporter({
        url: `${endpoint}/v1/traces`,
        timeoutMillis: TELEMETRY_EXPORT_TIMEOUT_MS,
        concurrencyLimit: 1,
      }),
      metrics: new OTLPMetricExporter({
        url: `${endpoint}/v1/metrics`,
        timeoutMillis: TELEMETRY_EXPORT_TIMEOUT_MS,
        concurrencyLimit: 1,
      }),
    },
  });
}
