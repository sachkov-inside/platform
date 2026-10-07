// Billing hands these delegates to their owners instead of accessing their state.
export async function activateByHand(transaction: {
  activationAttempt: { update(input: unknown): Promise<unknown> };
  telegramAccountLinkState: { findUnique(input: unknown): Promise<unknown> };
}): Promise<void> {
  await transaction.activationAttempt.update({ data: {} });
  await transaction.telegramAccountLinkState.findUnique({ where: {} });
}
