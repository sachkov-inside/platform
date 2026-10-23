import type { TelegramMembershipPrisma } from "../../../infrastructure/prisma/index.js";
import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../infrastructure/prisma/transaction-handle.js";
export function telegramTransaction(
  handle: TransactionHandle,
): TelegramMembershipPrisma {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The owning persistence adapter narrows the validated connection to its own delegates.
  return unwrapTransaction(handle) as TelegramMembershipPrisma;
}
