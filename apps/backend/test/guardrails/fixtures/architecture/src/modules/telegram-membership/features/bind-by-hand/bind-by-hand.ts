// Telegram hands its transaction to Membership; it cannot create Membership rows itself.
export async function bindByHand(transaction: {
  membershipBinding: { create(input: unknown): Promise<unknown> };
}): Promise<void> {
  await transaction.membershipBinding.create({ data: {} });
}
