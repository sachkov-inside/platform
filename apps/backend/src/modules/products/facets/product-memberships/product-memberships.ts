import { loadCatalogueMemberships } from "../../infrastructure/postgres/catalogue-memberships.js";
import type { ProductsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { type TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { ContentWriteTarget } from "../../../../infrastructure/content-authoring/content-write-policy.js";
import type { HeldProductRemoval } from "../../../../infrastructure/content-authoring/authoring-errors.js";
import { productsTransaction } from "../../infrastructure/transaction.js";
import {
  appendSelectedProductMemberships,
  lockMaterialProduct,
} from "../../infrastructure/postgres/product-order.js";
import {
  heldProductRemovals,
  recordProductRemovals,
} from "../../shared/product-removal-confirmation.js";
import type { ProductAccessHolders } from "../../ports/product-access-holders.js";
export interface MaterialMembership {
  readonly productId: string;
  readonly ordinal: number;
}
/** Owns the catalogue's Material relationship, its atomic edits, publication projection and removal audit. */
export class ProductMemberships {
  constructor(private readonly prisma: ProductsPrismaClient) {}
  async load(
    materialId: string,
    handle?: TransactionHandle,
  ): Promise<readonly MaterialMembership[]> {
    return (
      await loadCatalogueMemberships(
        handle === undefined ? this.prisma : productsTransaction(handle),
        { materialId },
      )
    ).map(({ productId, ordinal }) => ({ productId, ordinal }));
  }

  async publishedProductIds(
    materialId: string,
    handle: TransactionHandle,
  ): Promise<readonly string[]> {
    return (
      await productsTransaction(
        handle,
      ).publishedMaterialProductMembership.findMany({
        where: { materialId },
        select: { productId: true },
      })
    ).map((row) => row.productId);
  }
  async assignSelected(
    materialId: string,
    selectedIds: readonly string[],
    handle: TransactionHandle,
  ): Promise<readonly MaterialMembership[]> {
    return appendSelectedProductMemberships(
      productsTransaction(handle),
      materialId,
      selectedIds,
    );
  }
  async lockForMaterial(
    materialId: string,
    selectedIds: readonly string[],
    handle: TransactionHandle,
  ): Promise<void> {
    return lockMaterialProduct(
      productsTransaction(handle),
      materialId,
      selectedIds,
    );
  }
  async changedTargets(
    materialId: string,
    selectedIds: readonly string[],
    handle: TransactionHandle,
  ): Promise<readonly ContentWriteTarget[]> {
    const transaction = productsTransaction(handle);
    await lockMaterialProduct(transaction, materialId, selectedIds);
    const current = await transaction.productMembership.findMany({
      where: { materialId },
      select: { productId: true },
    });
    const before = new Set(current.map(({ productId }) => productId));
    const after = new Set(selectedIds);
    const changed = [...new Set([...before, ...after])].filter(
      (id) => before.has(id) !== after.has(id),
    );
    if (changed.length === 0) return [];
    const products = await transaction.product.findMany({
      where: { id: { in: changed } },
      select: { id: true, sourceId: true },
    });
    return products.map((product) => ({
      kind: "membership",
      sourceId: product.sourceId,
      path: selectedIds.includes(product.id)
        ? `/metadata/productIds/${String(selectedIds.indexOf(product.id))}`
        : "/metadata/productIds",
    }));
  }
  async replace(
    materialId: string,
    memberships: readonly MaterialMembership[],
    handle: TransactionHandle,
  ): Promise<void> {
    const transaction = productsTransaction(handle);
    const selected = memberships.map((entry) => entry.productId);
    const current = await transaction.productMembership.findMany({
      where: { materialId },
      select: { productId: true },
    });
    await transaction.productMembership.deleteMany({
      where: { materialId, productId: { notIn: selected } },
    });
    const existing = new Set(current.map((entry) => entry.productId));
    const added = selected.filter((id) => !existing.has(id));
    if (added.length > 0)
      await transaction.productMembership.createMany({
        data: added.map((productId) => ({ materialId, productId })),
      });
  }

  async setPublication(
    materialId: string,
    memberships: readonly MaterialMembership[] | null,
    handle: TransactionHandle,
  ): Promise<void> {
    const tx = productsTransaction(handle);
    await tx.publishedMaterialProductMembership.deleteMany({
      where: { materialId },
    });
    if (memberships !== null && memberships.length > 0)
      await tx.publishedMaterialProductMembership.createMany({
        data: memberships.map((entry) => ({
          productId: entry.productId,
          materialId,
        })),
      });
  }
  async detachMaterial(
    materialId: string,
    handle: TransactionHandle,
  ): Promise<void> {
    const tx = productsTransaction(handle);
    await tx.productArtifactMaterialLink.deleteMany({ where: { materialId } });
    await tx.publishedMaterialProductMembership.deleteMany({
      where: { materialId },
    });
    await tx.productMembership.deleteMany({ where: { materialId } });
  }
  async inspectReferences(
    materialId: string,
    memberships: readonly MaterialMembership[],
    handle: TransactionHandle,
  ): Promise<{
    readonly issues: readonly {
      readonly code: string;
      readonly path: string;
    }[];
    readonly conflict?: MaterialMembership;
  }> {
    const tx = productsTransaction(handle);
    await lockMaterialProduct(
      tx,
      materialId,
      memberships.map((entry) => entry.productId),
    );
    const current = new Set(
      (
        await tx.productMembership.findMany({
          where: { materialId },
          select: { productId: true },
        })
      ).map((entry) => entry.productId),
    );
    const products = await tx.product.findMany({
      where: { id: { in: memberships.map((entry) => entry.productId) } },
      select: { id: true, archivedAt: true },
    });
    const known = new Map(products.map((product) => [product.id, product]));
    const issues = memberships.flatMap((entry, index) =>
      !known.has(entry.productId)
        ? [
            {
              code: "product_not_found",
              path: `/metadata/productMemberships/${index}/productId`,
            },
          ]
        : known.get(entry.productId)?.archivedAt !== null &&
            !current.has(entry.productId)
          ? [
              {
                code: "product_archived",
                path: `/metadata/productMemberships/${index}/productId`,
              },
            ]
          : [],
    );
    return { issues };
  }

  async heldRemovals(
    ids: readonly string[],
    holders: ProductAccessHolders | undefined,
    handle: TransactionHandle,
  ): Promise<readonly HeldProductRemoval[]> {
    return heldProductRemovals(productsTransaction(handle), holders, ids);
  }
  async recordRemovals(
    values: Parameters<typeof recordProductRemovals>[1],
    handle: TransactionHandle,
  ): Promise<void> {
    return recordProductRemovals(productsTransaction(handle), values);
  }
}
export const PRODUCT_MEMBERSHIPS = Symbol("PRODUCT_MEMBERSHIPS");
