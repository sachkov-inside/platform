import type { ProductsPrisma } from "../../../infrastructure/prisma/index.js";
import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../infrastructure/prisma/transaction-handle.js";

export function productsTransaction(handle: TransactionHandle): ProductsPrisma {
  return unwrapTransaction(handle) as ProductsPrisma;
}
