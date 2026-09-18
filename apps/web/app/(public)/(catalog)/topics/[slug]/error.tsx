"use client";

import { LibraryDiscoveryUnexpectedError } from "@/_pages/library-discovery";

/** `retry` перечитывает страницу с сервера; `reset` перерисовал бы тот же сбой без запроса. */
export default function TopicError({ retry }: { readonly retry: () => void }) {
  return <LibraryDiscoveryUnexpectedError onRetry={retry} />;
}
