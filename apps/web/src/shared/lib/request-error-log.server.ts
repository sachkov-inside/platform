import "server-only";

import { writeStructuredLog } from "./structured-log.server";

/** Сколько символов сообщения об ошибке попадает в журнал: достаточно, чтобы узнать сбой. */
const LOGGED_MESSAGE_LENGTH = 500;

/**
 * Серверный сбой запроса для `onRequestError`: код обращения совпадает с тем, что видит граница
 * ошибок в браузере. Заголовки и параметры адреса в журнал не попадают — в них cookie и данные
 * человека.
 */
export function logRequestError(
  error: unknown,
  request: { readonly method: string; readonly path: string },
  context: {
    readonly renderSource?: string;
    readonly routePath: string;
    readonly routeType: string;
  },
): void {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined;
  writeStructuredLog("error", "request-error", {
    ...(digest === undefined ? {} : { digest }),
    message: (error instanceof Error ? error.message : String(error)).slice(
      0,
      LOGGED_MESSAGE_LENGTH,
    ),
    method: request.method,
    name: error instanceof Error ? error.name : typeof error,
    path: request.path.split(/[?#]/u, 1)[0] ?? "/",
    ...(context.renderSource === undefined
      ? {}
      : { renderSource: context.renderSource }),
    routePath: context.routePath,
    routeType: context.routeType,
  });
}
