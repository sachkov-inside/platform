import { z } from "zod";

const context = {
  route: z.string().startsWith("/").max(512),
  mobile: z.boolean(),
};
export const telemetryReportSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...context,
    kind: z.literal("vitals"),
    metrics: z
      .array(
        z.strictObject({
          name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
          value: z.number().nonnegative(),
        }),
      )
      .min(1)
      .max(20),
  }),
  z.strictObject({
    ...context,
    kind: z.literal("error"),
    source: z.enum(["client", "server"]),
    digest: z.string().max(512).optional(),
    name: z.string().max(512),
    message: z.string().max(4096),
  }),
]);
export type TelemetryReport = z.infer<typeof telemetryReportSchema>;
