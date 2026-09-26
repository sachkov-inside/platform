import type {
  RenderErrorReport,
  WebVital,
  WebVitalsReport,
} from "../model/client-telemetry-contract";
import {
  MAX_WEB_VITALS_PER_REPORT,
  RENDER_ERRORS_ROUTE,
  RENDER_ERROR_MESSAGE_LENGTH,
  REPORT_LABEL_LENGTH,
  REPORT_PATH_LENGTH,
  REPORTED_WEB_VITALS,
  WEB_VITALS_ROUTE,
  WEB_VITAL_RATINGS,
} from "../model/client-telemetry-wire";

/** Поля метрики, которые уходят в отчёт; остальное Next.js оставляет себе. */
export interface ReportedWebVital {
  readonly id: string;
  readonly name: string;
  readonly navigationType?: string;
  readonly rating?: string;
  readonly value: number;
}

function isReportedName(name: string): name is WebVital["name"] {
  return (REPORTED_WEB_VITALS as readonly string[]).includes(name);
}

function isRating(
  rating: string | undefined,
): rating is NonNullable<WebVital["rating"]> {
  return (
    rating !== undefined &&
    (WEB_VITAL_RATINGS as readonly string[]).includes(rating)
  );
}

let pendingVitals: WebVital[] = [];
let documentRoute: string | undefined;
let flushesOnHide = false;

/**
 * Копит метрики загрузки и отправляет их одним отчётом, когда страницу скрывают: к этому моменту
 * LCP, CLS и INP уже окончательны. Путь запоминается на первой метрике — это адрес, с которого
 * документ загрузился.
 */
export function queueWebVital(metric: ReportedWebVital): void {
  const { name, rating } = metric;
  if (
    !isReportedName(name) ||
    pendingVitals.length >= MAX_WEB_VITALS_PER_REPORT
  )
    return;
  documentRoute ??= window.location.pathname.slice(0, REPORT_PATH_LENGTH);
  pendingVitals.push({
    id: metric.id.slice(0, REPORT_LABEL_LENGTH),
    name,
    ...(metric.navigationType === undefined
      ? {}
      : {
          navigationType: metric.navigationType.slice(0, REPORT_LABEL_LENGTH),
        }),
    ...(isRating(rating) ? { rating } : {}),
    value: Math.max(0, metric.value),
  });
  if (flushesOnHide) return;
  flushesOnHide = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushWebVitals();
  });
  window.addEventListener("pagehide", flushWebVitals);
}

function flushWebVitals(): void {
  if (pendingVitals.length === 0 || documentRoute === undefined) return;
  const report: WebVitalsReport = {
    metrics: pendingVitals,
    route: documentRoute,
  };
  pendingVitals = [];
  sendReport(WEB_VITALS_ROUTE, report);
}

/** Сообщает площадке об ошибке, которую поймала граница ошибок. */
export function reportRenderError(
  boundary: RenderErrorReport["boundary"],
  error: Error & { readonly digest?: string },
): void {
  const report: RenderErrorReport = {
    boundary,
    ...(error.digest === undefined
      ? {}
      : { digest: error.digest.slice(0, REPORT_LABEL_LENGTH) }),
    message: error.message.slice(0, RENDER_ERROR_MESSAGE_LENGTH),
    name: error.name.slice(0, REPORT_LABEL_LENGTH),
    route: window.location.pathname.slice(0, REPORT_PATH_LENGTH),
  };
  sendReport(RENDER_ERRORS_ROUTE, report);
}

/**
 * Отчёт не должен мешать странице: ни сбой отправки, ни её отсутствие не видны человеку. Если
 * beacon недоступен или отказал, тот же отчёт уходит обычным запросом `keepalive`.
 */
function sendReport(
  route: string,
  report: RenderErrorReport | WebVitalsReport,
): void {
  const body = new Blob([JSON.stringify(report)], { type: "application/json" });
  try {
    if (navigator.sendBeacon(route, body)) return;
  } catch {
    // Beacon недоступен — ниже тот же отчёт уходит запросом.
  }
  void fetch(route, {
    body,
    credentials: "same-origin",
    keepalive: true,
    method: "POST",
  }).catch(() => undefined);
}
