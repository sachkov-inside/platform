"use client";

import "@/_app/ui/fonts";
import { StandalonePageError } from "@/_pages/route-states";
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
        <StandalonePageError onRetry={retry} />
      </body>
    </html>
  );
}
