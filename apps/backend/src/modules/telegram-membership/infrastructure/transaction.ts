import type { TelegramMembershipPrisma } from "../../../infrastructure/prisma/index.js";
import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../infrastructure/prisma/transaction-handle.js";
export function telegramTransaction(
  handle: TransactionHandle,
): TelegramMembershipPrisma {
  return unwrapTransaction(handle) as TelegramMembershipPrisma;
}
