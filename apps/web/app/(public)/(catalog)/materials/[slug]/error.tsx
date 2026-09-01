"use client";

import { MaterialReaderUnexpectedError } from "@/_pages/material-reader";

export default function MaterialError({ reset }: { readonly reset: () => void }) {
  return <MaterialReaderUnexpectedError onRetry={reset} />;
}
