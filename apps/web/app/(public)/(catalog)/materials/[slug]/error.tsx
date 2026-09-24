"use client";

import { MaterialReaderUnexpectedError } from "@/_pages/material-reader";
import { useRenderErrorReport } from "@/features/client-telemetry";
import { useSearchParams } from "next/navigation";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

/** `retry` перечитывает страницу с сервера; `reset` перерисовал бы тот же сбой без запроса. */
export default function MaterialError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useRenderErrorReport("public", error);
  return (
    <MaterialReaderUnexpectedError
      onRetry={retry}
      returnTarget={parseMaterialReaderReturnTarget(
        useSearchParams().get("from"),
      )}
    />
  );
}
