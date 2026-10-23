import type {
  PlatformPrisma,
  TransactionClient,
} from "../../../infrastructure/prisma/prisma-client.js";

export type AccountRightsPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "$queryRaw"
  | "productAccess"
  | "productAccessSource"
  | "productAccessAction"
  | "activationRule"
  | "activationAttempt"
  | "sourceEntitlement"
  | "accessReceipt"
  | "accessChange"
>;

export type AccountRightsPrismaTransaction = AccountRightsPrisma;
export type AccountRightsPrismaClient = AccountRightsPrisma &
  TransactionClient<AccountRightsPrisma>;

import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../infrastructure/prisma/transaction-handle.js";

export function accountRightsTransaction(
  handle: TransactionHandle,
): AccountRightsPrisma {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The owning persistence adapter narrows the validated connection to its own delegates.
  return unwrapTransaction(handle) as AccountRightsPrisma;
}
