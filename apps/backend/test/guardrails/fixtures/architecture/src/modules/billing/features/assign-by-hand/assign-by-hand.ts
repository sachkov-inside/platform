// Billing hands its transaction to Membership; it cannot create Membership rows itself.
export async function assignByHand(transaction: {
  tariffAssignment: { create(input: unknown): Promise<unknown> };
}): Promise<void> {
  await transaction.tariffAssignment.create({ data: {} });
}
