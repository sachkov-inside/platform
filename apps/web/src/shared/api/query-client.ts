import { environmentManager, QueryClient } from "@tanstack/react-query";

/**
 * Общее окно свежести чтений (ADR 0027). Гидрированные и только что прочитанные данные не
 * перезапрашиваются при каждом монтировании; свежесть после записи дают инвалидация по ключу
 * владельца и объявления фактов. Нулевое окно остаётся у `selfRefreshingRead`, где человек ждёт
 * чужого изменения.
 */
const QUERY_STALE_TIME_MS = 30_000;
const QUERY_GARBAGE_COLLECTION_TIME_MS = 30 * 60_000;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A server client belongs to one request. A GC timer would retain that request's
        // async context, including rendered streams, until the browser's 30-minute window.
        gcTime: environmentManager.isServer()
          ? Infinity
          : QUERY_GARBAGE_COLLECTION_TIME_MS,
        staleTime: QUERY_STALE_TIME_MS,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/** Isolates server request caches while preserving one browser cache across renders. */
export function getQueryClient(): QueryClient {
  if (environmentManager.isServer()) {
    return createQueryClient();
  }

  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}
