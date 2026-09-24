"use client";

import { LibraryDiscoveryUnexpectedError } from "@/_pages/library-discovery";
import { useRenderErrorReport } from "@/features/client-telemetry";

/** `retry` перечитывает страницу с сервера; `reset` перерисовал бы тот же сбой без запроса. */
export default function TopicError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useRenderErrorReport("public", error);
  return <LibraryDiscoveryUnexpectedError onRetry={retry} />;
}
