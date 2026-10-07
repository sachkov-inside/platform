// Billing hands its transaction to Membership; it cannot create Membership rows itself.
export async function assignByHand(transaction: {
  subscriptionEnrollment: { create(input: unknown): Promise<unknown> };
}): Promise<void> {
  await transaction.subscriptionEnrollment.create({ data: {} });
}
