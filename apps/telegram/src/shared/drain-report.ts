/** Private lifetime evidence. Failure objects must never be logged or exported verbatim. */
export type DrainReport = Readonly<{
  quiescent: true;
  failures: readonly unknown[];
}>;

export function rejectFailures(failures: readonly unknown[]): void {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "Telegram application shutdown failed");
}
