"use client";

import "@fontsource-variable/manrope/wght.css";

import { PageUnexpectedError } from "@/_pages/route-states";
import { useRenderErrorReport } from "@/features/client-telemetry";

import "./globals.css";

/**
 * Сбой корневой раскладки. Эта страница заменяет её целиком, поэтому сама объявляет документ, язык,
 * заголовок вкладки и стили.
 */
export default function GlobalError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useRenderErrorReport("global", error);
  return (
    <html lang="ru">
      <body>
        <title>Страница недоступна · Sachkov Inside</title>
        <main className="grid min-h-svh place-items-center bg-background px-5 py-12 text-foreground">
          <PageUnexpectedError onRetry={retry} />
        </main>
      </body>
    </html>
  );
}
