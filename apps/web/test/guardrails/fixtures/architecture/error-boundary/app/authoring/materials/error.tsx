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
  return <main className="grid h-full min-h-svh place-items-center px-5 py-12 md:min-h-0"><button onClick={retry}>Повторить</button></main>;
}
