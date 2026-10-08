// A caller shares its transaction through the owner interface, without naming foreign tables.
export async function handoff(transaction: unknown, owner: (tx: unknown) => Promise<void>) {
  await owner(transaction);
}
