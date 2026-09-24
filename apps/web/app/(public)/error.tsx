"use client";

import { PageUnexpectedError } from "@/_pages/route-states";
import { useRenderErrorReport } from "@/features/client-telemetry";

/** Сбой публичной страницы без своей границы: оболочка остаётся, `retry` перечитывает страницу. */
export default function PublicError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useRenderErrorReport("public", error);
  return <PageUnexpectedError onRetry={retry} />;
}
