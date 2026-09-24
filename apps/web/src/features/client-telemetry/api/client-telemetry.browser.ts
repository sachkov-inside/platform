import type {
  RenderErrorReport,
  WebVital,
  WebVitalsReport,
} from "../model/client-telemetry-contract";
import {
  MAX_WEB_VITALS_PER_REPORT,
  RENDER_ERRORS_ROUTE,
  RENDER_ERROR_MESSAGE_LENGTH,
  WEB_VITALS_ROUTE,
} from "../model/client-telemetry-routes";

/** Поля метрики, которые уходят в отчёт; остальное Next.js оставляет себе. */
export interface ReportedWebVital {
  readonly id: string;
  readonly name: string;
  readonly navigationType?: string;
  readonly rating?: string;
  readonly value: number;
}

const reportedNames = new Set<string>(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]);
const reportedRatings = new Set<string>(["good", "needs-improvement", "poor"]);

let pendingVitals: WebVital[] = [];
let documentRoute: string | undefined;
let flushesOnHide = false;

/**
 * Копит метрики загрузки и отправляет их одним отчётом, когда страницу скрывают: к этому моменту
 * LCP, CLS и INP уже окончательны. Путь запоминается на первой метрике — это адрес, с которого
 * документ загрузился.
 */
export function queueWebVital(metric: ReportedWebVital): void {
  if (!reportedNames.has(metric.name) || pendingVitals.length >= MAX_WEB_VITALS_PER_REPORT) return;
  documentRoute ??= window.location.pathname;
  pendingVitals.push({
    id: metric.id,
    name: metric.name as WebVital["name"],
    ...(metric.navigationType === undefined ? {} : { navigationType: metric.navigationType }),
    ...(metric.rating === undefined || !reportedRatings.has(metric.rating)
      ? {}
      : { rating: metric.rating as NonNullable<WebVital["rating"]> }),
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
  const report: WebVitalsReport = { metrics: pendingVitals, route: documentRoute };
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
    ...(error.digest === undefined ? {} : { digest: error.digest.slice(0, 128) }),
    message: error.message.slice(0, RENDER_ERROR_MESSAGE_LENGTH),
    name: error.name.slice(0, 128),
    route: window.location.pathname.slice(0, 512),
  };
  sendReport(RENDER_ERRORS_ROUTE, report);
}

/** Отчёт не должен мешать странице: ни сбой отправки, ни её отсутствие не видны человеку. */
function sendReport(route: string, report: RenderErrorReport | WebVitalsReport): void {
  try {
    const body = new Blob([JSON.stringify(report)], { type: "application/json" });
    if (navigator.sendBeacon(route, body)) return;
    void fetch(route, { body, credentials: "same-origin", keepalive: true, method: "POST" }).catch(
      () => undefined,
    );
  } catch {
    // Измерение не должно мешать странице.
  }
}
