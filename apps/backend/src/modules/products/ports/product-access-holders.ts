import type { TransactionHandle } from "../../../infrastructure/prisma/transaction-handle.js";

export const PRODUCT_ACCESS_HOLDERS = Symbol("PRODUCT_ACCESS_HOLDERS");

/**
 * Сколько людей сейчас держат действующее право на руководство: купили его или получили тариф, в
 * составе которого оно есть. Materials спрашивает об этом, прежде чем убрать опубликованный
 * материал из руководства: снять материал из купленного продукта можно только подтверждением.
 */
export interface ProductAccessHolders {
  /** Читает в транзакции вызывающего: снятие держит блокировки Materials и второго соединения не ждёт. */
  countProductHolders(
    transaction: TransactionHandle,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
}

/**
 * Who may see holder counts in the authoring list. Product holders are a `billing:manage` read,
 * while the list itself is a `materials:manage` read; without this right the count stays absent.
 */
export interface HolderCountPolicy {
  canReadHolderCounts(accountId: string): Promise<boolean>;
}
