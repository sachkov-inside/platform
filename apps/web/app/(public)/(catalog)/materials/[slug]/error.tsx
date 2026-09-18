"use client";

import { MaterialReaderUnexpectedError } from "@/_pages/material-reader";
import { useSearchParams } from "next/navigation";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

/** `retry` перечитывает страницу с сервера; `reset` перерисовал бы тот же сбой без запроса. */
export default function MaterialError({ retry }: { readonly retry: () => void }) {
  return (
    <MaterialReaderUnexpectedError
      onRetry={retry}
      returnTarget={parseMaterialReaderReturnTarget(
        useSearchParams().get("from"),
      )}
    />
  );
}
