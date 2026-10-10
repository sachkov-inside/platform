"use client";

import { MaterialAuthoringRouteError } from "@/_pages/route-states";
import { useRenderErrorReport } from "@/features/client-telemetry";

/**
 * Сбой любого авторского раздела: авторская оболочка остаётся, `retry` перечитывает раздел с
 * сервера, а повторная отрисовка без запроса показала бы тот же сбой.
 */
export default function AuthoringError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useRenderErrorReport("authoring", error);
  return <MaterialAuthoringRouteError digest={error.digest} onRetry={retry} />;
}
