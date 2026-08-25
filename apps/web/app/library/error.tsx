"use client";

import { LibraryUnexpectedError } from "@/_pages/library";

export default function Error({ reset }: { readonly reset: () => void }) {
  return <LibraryUnexpectedError onRetry={reset} />;
}
