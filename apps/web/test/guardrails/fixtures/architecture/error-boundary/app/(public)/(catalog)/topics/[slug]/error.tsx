"use client";

/** Сбой не попадает в журнал, а `reset` перерисует тот же сбой без запроса. */
export default function TopicError({
  reset,
}: {
  readonly error: Error;
  readonly reset: () => void;
}) {
  return <button onClick={reset}>Повторить</button>;
}
