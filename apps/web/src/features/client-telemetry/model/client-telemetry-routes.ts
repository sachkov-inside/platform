/** Адреса отчётов браузера. Отдельно от схем, чтобы отправка не тянула `zod` в клиентский код. */
export const WEB_VITALS_ROUTE = "/api/web-vitals";
export const RENDER_ERRORS_ROUTE = "/api/render-errors";

/** Сколько символов сообщения об ошибке уходит в отчёт: достаточно, чтобы узнать сбой. */
export const RENDER_ERROR_MESSAGE_LENGTH = 500;
/** Больше метрик одна загрузка страницы не набирает: каждая Core Web Vital приходит один раз. */
export const MAX_WEB_VITALS_PER_REPORT = 20;
