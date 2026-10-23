import type { VideosPrisma } from "../../../infrastructure/prisma/index.js";
import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../infrastructure/prisma/transaction-handle.js";
export function videosTransaction(handle: TransactionHandle): VideosPrisma {
  return unwrapTransaction(handle) as VideosPrisma;
}
