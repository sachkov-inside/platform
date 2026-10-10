import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") {
    return;
  }

  const { validateWebRuntimeConfigOrExit } =
    await import("./src/shared/config/index.server");
  validateWebRuntimeConfigOrExit();

  // SDK Request bodies need HTTP/1.1 framing for Logto's token parser (ADR 0032).
  const { Agent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new Agent({ allowH2: false }));
}

/** Серверный сбой отрисовки или обработчика — строкой в журнал площадки с кодом обращения. */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") {
    return;
  }

  const { logRequestError } =
    await import("./src/shared/lib/request-error-log.server");
  const report = logRequestError(error, request, context);
  const { persistServerError } =
    await import("./src/features/client-telemetry.server");
  await persistServerError(report, request.headers);
};
