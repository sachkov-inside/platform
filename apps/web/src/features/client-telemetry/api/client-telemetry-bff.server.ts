import "server-only";
import type { z } from "zod";

import {
  isSameOriginMutation,
  readLogtoBffConfig,
} from "@/shared/auth/index.server";
import { readWebRuntimeMode } from "@/shared/config/index.server";
import { writeStructuredLog } from "@/shared/lib/structured-log.server";
import {
  MAX_CLIENT_TELEMETRY_BYTES,
  renderErrorReportSchema,
  webVitalsReportSchema,
} from "../model/client-telemetry-contract";
import {
  admitClientReport,
  CLIENT_REPORT_WINDOW_SECONDS,
  type ClientReportKind,
  clientReportRecordsPerWindow,
} from "./client-report-ceiling.server";

/**
 * Core Web Vitals одной загрузки страницы. Каждая метрика — своя строка журнала: так их проще
 * отбирать по имени и сравнивать по адресу.
 */
export async function handleWebVitalsReport(
  request: Request,
): Promise<Response> {
  const report = await readReport(request, webVitalsReportSchema);
  if (!report.ok) return telemetryResponse(report.status);
  const refusal = refuseOverCeiling("web-vitals", report.value.metrics.length);
  if (refusal !== undefined) return refusal;
  for (const metric of report.value.metrics) {
    writeStructuredLog("info", "web-vital", {
      route: report.value.route,
      ...metric,
    });
  }
  return telemetryResponse(204);
}

/** Ошибка отрисовки, которую поймала граница ошибок в браузере. */
export async function handleRenderErrorReport(
  request: Request,
): Promise<Response> {
  const report = await readReport(request, renderErrorReportSchema);
  if (!report.ok) return telemetryResponse(report.status);
  const refusal = refuseOverCeiling("render-errors", 1);
  if (refusal !== undefined) return refusal;
  writeStructuredLog("error", "client-render-error", report.value);
  return telemetryResponse(204);
}

/**
 * Отчёт сверх общего потолка получает `429` и в журнал не попадает. Первый отказ в окне оставляет
 * одну строку: так в журнале видно, что отчёты этого вида терялись. Стенд и проверки на `next dev`
 * потолка не видят — как и предела на клиента в `proxy.ts`.
 */
function refuseOverCeiling(
  kind: ClientReportKind,
  records: number,
): Response | undefined {
  if (readWebRuntimeMode() !== "production") return undefined;
  const admission = admitClientReport(kind, records);
  if (admission.admitted) return undefined;
  if (admission.firstRefusal) {
    writeStructuredLog("error", "client-report-limit-reached", {
      recordsPerWindow: clientReportRecordsPerWindow[kind],
      report: kind,
      windowSeconds: CLIENT_REPORT_WINDOW_SECONDS,
    });
  }
  const response = telemetryResponse(429);
  response.headers.set("retry-after", String(admission.retryAfterSeconds));
  return response;
}

/**
 * Узкое исключение из общей границы BFF (`handleAuthenticatedMutation`): отчёт присылает и гость,
 * поэтому сессии здесь нет, а тело — JSON, а не форма. От общей границы остаются проверка Origin,
 * предел тела — меньший, `MAX_CLIENT_TELEMETRY_BYTES`, — и ответ `no-store, private`.
 */
async function readReport<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<
  | { readonly ok: true; readonly value: z.infer<Schema> }
  | { readonly ok: false; readonly status: number }
> {
  if (!isSameOriginMutation(request, readLogtoBffConfig().baseUrl))
    return { ok: false, status: 403 };
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_CLIENT_TELEMETRY_BYTES
  ) {
    return { ok: false, status: 413 };
  }
  const text = await readBoundedText(request, MAX_CLIENT_TELEMETRY_BYTES);
  if (text === undefined) return { ok: false, status: 413 };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, status: 400 };
  }
  const parsed = schema.safeParse(body);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, status: 400 };
}

/** Читает тело до предела: заявленная длина может отсутствовать, а поток — оказаться длиннее. */
async function readBoundedText(
  request: Request,
  maxBytes: number,
): Promise<string | undefined> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    received += chunk.value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}

function telemetryResponse(status: number): Response {
  return new Response(null, {
    headers: { "cache-control": "no-store, private" },
    status,
  });
}
