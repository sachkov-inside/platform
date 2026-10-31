import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { z } from "zod";
import type { RuntimeMode } from "@inside/runtime-identity";
import { loadTelegramImageIdentity } from "./image-identity.js";
import {
  createTelegramObservability,
  type TelegramRuntimeTelemetry,
} from "./telegram-sdk.js";
import { disabledTelegramHttpObservability } from "./http-observability.js";
import { disabledTelegramObservability } from "./telegram-observability.js";
import { rejectFailures } from "../shared/drain-report.js";

const disabledRuntime: TelegramRuntimeTelemetry = {
  ...disabledTelegramObservability,
  ...disabledTelegramHttpObservability,
};

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

/** Optional operator configuration only. No request data or mandatory business config fields. */
export function telegramObservabilityFromEnvironment(input: {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly mode: RuntimeMode;
}): TelegramRuntimeTelemetry {
  if (input.environment["INSIDE_OTEL_ENABLED"] !== "true")
    return disabledRuntime;
  // Pinned exporters merge ambient OTLP headers, endpoints and certificate configuration.
  if (
    [input.environment, process.env].some((environment) =>
      Object.keys(environment).some((key) =>
        key.startsWith("OTEL_EXPORTER_OTLP"),
      ),
    )
  )
    return disabledRuntime;
  const parsed = runtimeSchema.safeParse(input.environment);
  if (!parsed.success) return disabledRuntime;
  const identity =
    input.mode === "production"
      ? loadTelegramImageIdentity()
      : {
          release: input.mode,
          sourceSha: "0000000000000000000000000000000000000000",
        };
  if (identity === undefined) return disabledRuntime;
  const endpoint = parsed.data.INSIDE_OTEL_ENDPOINT.replace(/\/$/u, "");
  let spans: OTLPTraceExporter | undefined;
  let metrics: OTLPMetricExporter | undefined;
  try {
    spans = new OTLPTraceExporter({
      url: `${endpoint}/v1/traces`,
      timeoutMillis: 1000,
      concurrencyLimit: 1,
    });
    metrics = new OTLPMetricExporter({
      url: `${endpoint}/v1/metrics`,
      timeoutMillis: 1000,
      concurrencyLimit: 1,
    });
    return createTelegramObservability({
      identity,
      mode: input.mode,
      sampleRatio: parsed.data.INSIDE_OTEL_SAMPLE_RATIO,
      exporters: { spans, metrics },
    });
  } catch {
    const owners = [spans, metrics];
    // Cleanup starts now, but its original failures stay private until the lifetime owner awaits it.
    const cleanup = Promise.allSettled(
      owners.map((owner) => Promise.resolve().then(() => owner?.shutdown())),
    );
    let closing: Promise<void> | undefined;
    return {
      ...disabledRuntime,
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
