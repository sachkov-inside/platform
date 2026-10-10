// Billing can only hand these delegates to Membership through its transaction.
export async function writeMembershipByHand(transaction: {
  accessReceipt: { create(input: unknown): Promise<unknown> };
  tariffAssignment: { findUnique(input: unknown): Promise<unknown> };
  accessBatchPreview: { create(input: unknown): Promise<unknown> };
  activationRule: { upsert(input: unknown): Promise<unknown> };
}): Promise<void> {
  await transaction.accessReceipt.create({ data: {} });
  await transaction.tariffAssignment.findUnique({ where: {} });
  await transaction.accessBatchPreview.create({ data: {} });
  await transaction.activationRule.upsert({ where: {}, create: {}, update: {} });
}
