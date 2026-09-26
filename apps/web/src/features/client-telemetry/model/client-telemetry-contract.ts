import { z } from "zod";

import {
  MAX_WEB_VITALS_PER_REPORT,
  RENDER_ERROR_BOUNDARIES,
  RENDER_ERROR_MESSAGE_LENGTH,
  REPORT_LABEL_LENGTH,
  REPORT_PATH_LENGTH,
  REPORTED_WEB_VITALS,
  WEB_VITAL_RATINGS,
} from "./client-telemetry-wire";

/** Отчёт браузера мал: несколько чисел или одно усечённое сообщение. */
export const MAX_CLIENT_TELEMETRY_BYTES = 16 * 1_024;

/** Путь страницы без запроса: параметры адреса в журнал не попадают. */
const pagePathSchema = z
  .string()
  .startsWith("/")
  .max(REPORT_PATH_LENGTH)
  .regex(/^[^?#]*$/u);

export const webVitalSchema = z
  .object({
    id: z.string().min(1).max(REPORT_LABEL_LENGTH),
    name: z.enum(REPORTED_WEB_VITALS),
    navigationType: z.string().max(REPORT_LABEL_LENGTH).optional(),
    rating: z.enum(WEB_VITAL_RATINGS).optional(),
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
    boundary: z.enum(RENDER_ERROR_BOUNDARIES),
    digest: z.string().max(REPORT_LABEL_LENGTH).optional(),
    message: z.string().max(RENDER_ERROR_MESSAGE_LENGTH),
    name: z.string().max(REPORT_LABEL_LENGTH),
    route: pagePathSchema,
  })
  .strict();

export type WebVital = z.infer<typeof webVitalSchema>;
export type WebVitalsReport = z.infer<typeof webVitalsReportSchema>;
export type RenderErrorReport = z.infer<typeof renderErrorReportSchema>;
