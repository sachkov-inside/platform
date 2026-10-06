"use client";

import { useRenderErrorReport } from "@/features/client-telemetry";

/** `reset` в остатке свойств — тот же `reset` границы. */
export default function WelcomeError({
  error,
  ...actions
}: {
  readonly error: Error;
  readonly reset: () => void;
}) {
  useRenderErrorReport("public", error);
  return <button onClick={actions.reset}>Повторить</button>;
}
