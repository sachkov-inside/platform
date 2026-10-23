import type {
  ContentCoversPrisma,
  ContentCoversPrismaClient,
} from "../../../infrastructure/prisma/index.js";
import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../infrastructure/prisma/transaction-handle.js";
export type ContentCoversPersistence = ContentCoversPrisma;
export type ContentCoversPersistenceClient = ContentCoversPrismaClient;
export function coverPersistence(
  handle: TransactionHandle,
): ContentCoversPersistence {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The owning persistence adapter narrows the validated connection to its own delegates.
  return unwrapTransaction(handle) as ContentCoversPersistence;
}
