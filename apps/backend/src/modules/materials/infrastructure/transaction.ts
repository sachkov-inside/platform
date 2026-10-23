import type { MaterialsPrisma } from "../../../infrastructure/prisma/index.js";
import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../infrastructure/prisma/transaction-handle.js";
export function materialsTransaction(
  handle: TransactionHandle,
): MaterialsPrisma {
  return unwrapTransaction(handle) as MaterialsPrisma;
}
