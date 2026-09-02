"use client";

import { MaterialReaderUnexpectedError } from "@/_pages/material-reader";
import { useSearchParams } from "next/navigation";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

export default function MaterialError({ reset }: { readonly reset: () => void }) {
  return (
    <MaterialReaderUnexpectedError
      onRetry={reset}
      returnTarget={parseMaterialReaderReturnTarget(
        useSearchParams().get("from"),
      )}
    />
  );
}
