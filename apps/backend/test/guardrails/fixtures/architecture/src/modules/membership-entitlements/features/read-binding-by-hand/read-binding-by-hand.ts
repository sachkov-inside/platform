// Membership hands its transaction to Telegram; it cannot read Telegram rows itself.
export async function readBindingByHand(transaction: {
  telegramAccountLinkState: { findUnique(input: unknown): Promise<unknown> };
  telegramAccountLinkHistory: { findUnique(input: unknown): Promise<unknown> };
}): Promise<void> {
  await transaction.telegramAccountLinkState.findUnique({ where: {} });
  await transaction.telegramAccountLinkHistory.findUnique({ where: {} });
}
