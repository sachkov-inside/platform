import "server-only";
import type { z } from "zod";

import { isSameOriginMutation, readLogtoBffConfig } from "@/shared/auth/index.server";
import { writeStructuredLog } from "@/shared/lib/structured-log.server";
import {
  MAX_CLIENT_TELEMETRY_BYTES,
  renderErrorReportSchema,
  webVitalsReportSchema,
} from "../model/client-telemetry-contract";

/**
 * Core Web Vitals одной загрузки страницы. Каждая метрика — своя строка журнала: так их проще
 * отбирать по имени и сравнивать по адресу.
 */
export async function handleWebVitalsReport(request: Request): Promise<Response> {
  const report = await readReport(request, webVitalsReportSchema);
  if (!report.ok) return telemetryResponse(report.status);
  for (const metric of report.value.metrics) {
    writeStructuredLog("info", "web-vital", { route: report.value.route, ...metric });
  }
  return telemetryResponse(204);
}

/** Ошибка отрисовки, которую поймала граница ошибок в браузере. */
export async function handleRenderErrorReport(request: Request): Promise<Response> {
  const report = await readReport(request, renderErrorReportSchema);
  if (!report.ok) return telemetryResponse(report.status);
  writeStructuredLog("error", "client-render-error", report.value);
  return telemetryResponse(204);
}

async function readReport<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<{ readonly ok: true; readonly value: z.infer<Schema> } | { readonly ok: false; readonly status: number }> {
  if (!isSameOriginMutation(request, readLogtoBffConfig().baseUrl)) return { ok: false, status: 403 };
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CLIENT_TELEMETRY_BYTES) {
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
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, status: 400 };
}

/** Читает тело до предела: заявленная длина может отсутствовать, а поток — оказаться длиннее. */
async function readBoundedText(request: Request, maxBytes: number): Promise<string | undefined> {
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
  return new Response(null, { headers: { "cache-control": "no-store, private" }, status });
}
