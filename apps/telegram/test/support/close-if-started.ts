/** Close an owned fixture even when setup failed before assigning its local variable. */
export async function closeIfStarted(
  fixture: { close(): Promise<unknown> } | undefined,
): Promise<void> {
  await fixture?.close();
}
