import "server-only";

import { writeStructuredLog } from "./structured-log.server";
import { diagnosticError } from "./diagnostic-text.server";

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
) {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : undefined;
  const routePath = context.routePath
    .split("/")
    .filter((part) => !part.startsWith("("))
    .join("/");
  const report = {
    ...diagnosticError(
      {
        digest,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      },
      "server",
    ),
    method: request.method,
    // Next supplies the source route template; the concrete URL can contain personal data.
    path: routePath === "" ? "/" : routePath,
    ...(context.renderSource === undefined
      ? {}
      : { renderSource: context.renderSource }),
    routePath: context.routePath,
    routeType: context.routeType,
  };
  writeStructuredLog("error", "request-error", report);
  return report;
}
