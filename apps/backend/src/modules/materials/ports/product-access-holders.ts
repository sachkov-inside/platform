import type { MaterialsPrisma } from "../../../infrastructure/prisma/index.js";

/**
 * Сколько людей сейчас держат действующее право на руководство: купили его или получили тариф, в
 * составе которого оно есть. Materials спрашивает об этом, прежде чем убрать опубликованный
 * материал из руководства: снять материал из купленного продукта можно только подтверждением.
 */
export interface ProductAccessHolders {
  /** Читает в транзакции вызывающего: снятие держит блокировки Materials и второго соединения не ждёт. */
  countProductHolders(
    transaction: Pick<MaterialsPrisma, "$queryRaw">,
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, number>>;
}
