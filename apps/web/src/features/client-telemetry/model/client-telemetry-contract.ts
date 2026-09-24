import { z } from "zod";

import {
  MAX_WEB_VITALS_PER_REPORT,
  RENDER_ERROR_MESSAGE_LENGTH,
} from "./client-telemetry-routes";

/** Отчёт браузера мал: несколько чисел или одно усечённое сообщение. */
export const MAX_CLIENT_TELEMETRY_BYTES = 16 * 1_024;

/** Путь страницы без запроса: параметры адреса в журнал не попадают. */
const pagePathSchema = z.string().startsWith("/").max(512).regex(/^[^?#]*$/u);

export const webVitalSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.enum(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]),
    navigationType: z.string().max(32).optional(),
    rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
    value: z.number().nonnegative(),
  })
  .strict();

export const webVitalsReportSchema = z
  .object({
    metrics: z.array(webVitalSchema).min(1).max(MAX_WEB_VITALS_PER_REPORT),
    route: pagePathSchema,
  })
  .strict();

export const renderErrorReportSchema = z
  .object({
    boundary: z.enum(["authoring", "global", "public", "root"]),
    digest: z.string().max(128).optional(),
    message: z.string().max(RENDER_ERROR_MESSAGE_LENGTH),
    name: z.string().max(128),
    route: pagePathSchema,
  })
  .strict();

export type WebVital = z.infer<typeof webVitalSchema>;
export type WebVitalsReport = z.infer<typeof webVitalsReportSchema>;
export type RenderErrorReport = z.infer<typeof renderErrorReportSchema>;
