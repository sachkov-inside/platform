"use client";

import { GuideTaskUnexpectedError } from "@/_pages/guide-task";
import { useRenderErrorReport } from "@/features/client-telemetry";

/** `retry` перечитывает страницу с сервера; `reset` перерисовал бы тот же сбой без запроса. */
export default function GuideTaskError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useRenderErrorReport("public", error);
  return <GuideTaskUnexpectedError onRetry={retry} />;
}
