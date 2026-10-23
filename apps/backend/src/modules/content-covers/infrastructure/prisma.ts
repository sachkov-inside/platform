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
  return unwrapTransaction(handle) as ContentCoversPersistence;
}
