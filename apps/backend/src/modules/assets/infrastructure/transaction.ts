import type { AssetsPrisma } from "../../../infrastructure/prisma/index.js";
import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../infrastructure/prisma/transaction-handle.js";
export function assetsTransaction(handle: TransactionHandle): AssetsPrisma {
  return unwrapTransaction(handle) as AssetsPrisma;
}
