import type { AccountsPrisma } from "../../../infrastructure/prisma/index.js";
import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../infrastructure/prisma/transaction-handle.js";

export function accountsTransaction(handle: TransactionHandle): AccountsPrisma {
  return unwrapTransaction(handle) as AccountsPrisma;
}
