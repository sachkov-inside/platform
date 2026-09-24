import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { validateWebRuntimeConfigOrExit } = await import(
    "./src/shared/config/index.server"
  );
  validateWebRuntimeConfigOrExit();
}

/** Серверный сбой отрисовки или обработчика — строкой в журнал площадки с кодом обращения. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { logRequestError } = await import("./src/shared/lib/request-error-log.server");
  logRequestError(error, request, context);
};
