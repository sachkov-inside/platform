"use client";

import { ProductTaskUnexpectedError } from "@/_pages/product-task";
import { useRenderErrorReport } from "@/features/client-telemetry";

/** `retry` перечитывает страницу с сервера; `reset` перерисовал бы тот же сбой без запроса. */
export default function ProductTaskError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useRenderErrorReport("public", error);
  return <ProductTaskUnexpectedError onRetry={retry} />;
}
