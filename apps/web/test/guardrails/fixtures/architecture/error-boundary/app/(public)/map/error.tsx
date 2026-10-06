"use client";

import { useRenderErrorReport } from "@/features/client-telemetry";

/** Граница, объявленная выше экспорта, держит то же правило. */
function MapError({
  error,
  reset,
}: {
  readonly error: Error;
  readonly reset: () => void;
}) {
  useRenderErrorReport("public", error);
  return <button onClick={reset}>Повторить</button>;
}

export default MapError;
