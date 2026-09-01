"use client";

import { LibraryUnexpectedError } from "@/_pages/library";

export default function LibraryError({ reset }: { readonly reset: () => void }) {
  return <LibraryUnexpectedError onRetry={reset} />;
}
