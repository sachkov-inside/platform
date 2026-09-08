"use client";

import { LibraryDiscoveryUnexpectedError } from "@/_pages/library-discovery";

export default function SeriesError({ reset }: { readonly reset: () => void }) {
  return <LibraryDiscoveryUnexpectedError onRetry={reset} />;
}
