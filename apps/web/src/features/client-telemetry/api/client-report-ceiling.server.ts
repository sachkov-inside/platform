import "server-only";

/**
 * Общий потолок строк журнала, которые отчёты браузера пишут за окно, — на все адреса вместе.
 * Предел на один адрес держит `proxy.ts` (ADR 0028), но поток с многих адресов он не
 * останавливает; этот потолок ограничивает сам объём журнала. Счёт живёт в памяти единственного
 * процесса web и, как счётчики proxy, действует только в production-сборке.
 */
export const CLIENT_REPORT_WINDOW_SECONDS = 60;

/**
 * Строк журнала за окно для каждого вида отчёта. Страница сообщает пять метрик загрузки, поэтому
 * потолок метрик вмещает около 60 скрытых вкладок в минуту. Ошибки считаются отдельно: поток метрик
 * не должен вытеснять их.
 */
export const clientReportRecordsPerWindow = {
  "render-errors": 60,
  "web-vitals": 300,
} as const;

export type ClientReportKind = keyof typeof clientReportRecordsPerWindow;

type ClientReportAdmission =
  | { readonly admitted: true }
  | {
      readonly admitted: false;
      /** Первый отказ в окне: о нём журнал узнаёт одной строкой. */
      readonly firstRefusal: boolean;
      readonly retryAfterSeconds: number;
    };

const windowMilliseconds = CLIENT_REPORT_WINDOW_SECONDS * 1_000;

/** Один счёт на процесс web: production запускает ровно один экземпляр (ADR 0028). */
const windows = new Map<
  ClientReportKind,
  { readonly startedAt: number; used: number; refused: boolean }
>();

/** Принимает отчёт целиком, если все его строки помещаются под потолок окна; иначе не пишет ни одной. */
export function admitClientReport(
  kind: ClientReportKind,
  records: number,
): ClientReportAdmission {
  const at = Date.now();
  let window = windows.get(kind);
  if (window === undefined || at - window.startedAt >= windowMilliseconds) {
    window = { refused: false, startedAt: at, used: 0 };
    windows.set(kind, window);
  }
  if (window.used + records <= clientReportRecordsPerWindow[kind]) {
    window.used += records;
    return { admitted: true };
  }
  const firstRefusal = !window.refused;
  window.refused = true;
  return {
    admitted: false,
    firstRefusal,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((window.startedAt + windowMilliseconds - at) / 1_000),
    ),
  };
}
