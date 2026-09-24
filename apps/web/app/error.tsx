"use client";

import { PageUnexpectedError } from "@/_pages/route-states";
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
  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 py-12 text-foreground">
      <PageUnexpectedError onRetry={retry} />
    </main>
  );
}
