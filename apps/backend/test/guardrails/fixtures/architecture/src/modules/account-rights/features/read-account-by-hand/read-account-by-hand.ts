// Membership may hand its transaction to Accounts, but must not read Account rows itself.
export async function readAccountByHand(
  transaction: { account: { findUnique(input: unknown): Promise<unknown> } },
): Promise<unknown> {
  return transaction.account.findUnique({ where: { id: "account-id" } });
}
