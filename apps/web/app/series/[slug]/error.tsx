"use client";

import { LibraryDiscoveryUnexpectedError } from "@/_pages/library-discovery";

export default function Error({ reset }: { readonly reset: () => void }) {
  return <LibraryDiscoveryUnexpectedError onRetry={reset} />;
}
