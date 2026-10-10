"use client";

import { useRenderErrorReport } from "@/features/client-telemetry";

/** `reset` из свойств, прочитанный через объект, перерисует тот же сбой без запроса. */
export default function ProductError(props: {
  readonly error: Error;
  readonly reset: () => void;
}) {
  useRenderErrorReport("public", props.error);
  return <button onClick={props.reset}>Повторить</button>;
}
