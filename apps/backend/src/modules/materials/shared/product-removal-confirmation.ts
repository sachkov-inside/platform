import { randomUUID } from "node:crypto";

import type { MaterialsPrismaTransaction } from "../../../infrastructure/prisma/index.js";
import type { HeldProductRemoval } from "../facets/material-authoring/material-authoring.contract.js";
import type { ProductAccessHolders } from "../ports/product-access-holders.js";

/**
 * Руководства с держателями права, из которых операция убирает опубликованный материал. Снятие
 * из руководства без держателей подтверждения не требует: купленного там никто не теряет.
 */
export async function heldProductRemovals(
  transaction: MaterialsPrismaTransaction,
  holders: ProductAccessHolders | undefined,
  productIds: readonly string[],
): Promise<readonly HeldProductRemoval[]> {
  if (holders === undefined || productIds.length === 0) return [];
  const unique = [...new Set(productIds)];
  const counts = await holders.countProductHolders(transaction, unique);
  const held = unique.filter((productId) => (counts.get(productId) ?? 0) > 0);
  if (held.length === 0) return [];
  const products = await transaction.product.findMany({
    where: { id: { in: held } },
    select: { id: true, name: true },
  });
  return held.map((productId) => ({
    productId,
    holders: counts.get(productId) ?? 0,
    name: products.find(({ id }) => id === productId)?.name ?? "",
  }));
}

/** Какие из затронутых руководств команда ещё не подтвердила. */
export function unconfirmedProductRemovals(
  removals: readonly HeldProductRemoval[],
  confirmedProductIds: readonly string[],
): readonly HeldProductRemoval[] {
  return removals.filter(
    ({ productId }) => !confirmedProductIds.includes(productId),
  );
}

/** Запись подтверждённого снятия: одна строка на пару «руководство — материал». */
export async function recordProductRemovals(
  transaction: MaterialsPrismaTransaction,
  values: {
    readonly actor: string;
    readonly operation: "material_save" | "product_composition";
    readonly removals: readonly {
      readonly product: HeldProductRemoval;
      readonly materialId: string;
    }[];
    readonly removedAt: Date;
  },
): Promise<void> {
  if (values.removals.length === 0) return;
  await transaction.productMaterialRemoval.createMany({
    data: values.removals.map(({ product, materialId }) => ({
      actorAccountId: values.actor,
      productId: product.productId,
      holders: product.holders,
      id: randomUUID(),
      materialId,
      operation: values.operation,
      removedAt: values.removedAt,
    })),
  });
}
