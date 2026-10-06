"use client";

import { useRenderErrorReport } from "@/features/client-telemetry";

export default function AuthoringError({
  error,
  retry,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly retry: () => void;
}) {
  useRenderErrorReport("authoring", error);
  return <button onClick={retry}>Повторить</button>;
}
