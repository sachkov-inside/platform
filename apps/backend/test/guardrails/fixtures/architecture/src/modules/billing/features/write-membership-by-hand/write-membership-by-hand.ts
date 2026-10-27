import { unwrapTransaction, type TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
// A caller cannot expose foreign delegates or unwrap the shared transaction itself.
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

export function unwrapForeignTransaction(handle: TransactionHandle): unknown { return unwrapTransaction(handle); }
