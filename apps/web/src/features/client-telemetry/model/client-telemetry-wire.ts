/**
 * Проводной формат отчётов браузера: адреса, пределы полей и допустимые значения. Его читают и
 * схема обработчика, и отправка в браузере; модуль без `zod`, чтобы отправка не тянула схемы в
 * клиентский код.
 */
export const WEB_VITALS_ROUTE = "/api/web-vitals";
export const RENDER_ERRORS_ROUTE = "/api/render-errors";

/** Core Web Vitals, которые сообщает `useReportWebVitals`. */
export const REPORTED_WEB_VITALS = ["CLS", "FCP", "INP", "LCP", "TTFB"] as const;
export const WEB_VITAL_RATINGS = ["good", "needs-improvement", "poor"] as const;
export const RENDER_ERROR_BOUNDARIES = ["authoring", "global", "public", "root"] as const;

/** Больше метрик одна загрузка страницы не набирает: каждая приходит один раз. */
export const MAX_WEB_VITALS_PER_REPORT = 20;
/** Сколько символов сообщения об ошибке уходит в отчёт: достаточно, чтобы узнать сбой. */
export const RENDER_ERROR_MESSAGE_LENGTH = 500;
export const REPORT_LABEL_LENGTH = 128;
export const REPORT_PATH_LENGTH = 512;
