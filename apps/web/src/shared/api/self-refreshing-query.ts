/**
 * Платформа обновляет данные сама: возврат во вкладку и восстановление сети перечитывают
 * состояние, а неудачное чтение повторяется по интервалу. Ручной кнопки обновления нет.
 */
export const selfRefreshingRead = {
  retry: false,
  staleTime: 0,
  refetchOnMount: "always",
  refetchOnReconnect: "always",
  refetchOnWindowFocus: "always",
} as const;

/** Пауза между повторами недоступного чтения: достаточно редко, чтобы не шуметь запросами. */
export const unavailableRetryIntervalMs = 15_000;
