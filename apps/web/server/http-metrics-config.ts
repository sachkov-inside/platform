import { z } from "zod";

export const webHttpSourceReadyKey = Symbol.for("inside.web.http.source.ready");

export const webHttpMetricsSchema = z
  .object({
    enabled: z.boolean(),
    environment: z.enum(["test", "isolated-pilot", "production"]),
    applicationPort: z.number().int().min(1).max(65535),
  })
  .readonly();

export function parseWebHttpMetricsConfig(
  environment: NodeJS.ProcessEnv,
  mode: string,
) {
  return webHttpMetricsSchema.parse({
    enabled:
      z
        .enum(["true", "false"])
        .default("false")
        .parse(environment["INSIDE_WEB_HTTP_METRICS_ENABLED"]) === "true",
    environment:
      environment["INSIDE_WEB_HTTP_METRICS_ENVIRONMENT"] ??
      (mode === "production" ? "production" : "test"),
    applicationPort: Number(environment["PORT"] ?? 3000),
  });
}
