"use client";

import { StandalonePageError } from "@/_pages/route-states";
import { useRenderErrorReport } from "@/features/client-telemetry";

/**
 * Сбой в самой раскладке раздела. Её оболочки здесь уже нет, поэтому состояние стоит посреди
 * экрана; `retry` перечитывает раздел с сервера.
 */
export default function RootError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useRenderErrorReport("root", error);
  return <StandalonePageError onRetry={retry} />;
}
