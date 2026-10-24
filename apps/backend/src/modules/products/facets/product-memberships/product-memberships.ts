import { loadCatalogueMemberships } from "../../infrastructure/postgres/catalogue-memberships.js";
import type { ProductsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { type TransactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import type { ContentWriteTarget } from "../../../../infrastructure/content-authoring/content-write-policy.js";
import type { HeldProductRemoval } from "../../../../infrastructure/content-authoring/authoring-errors.js";
import { productsTransaction } from "../../infrastructure/transaction.js";
import {
  appendSelectedSeriesMemberships,
  lockMaterialSeries,
} from "../../infrastructure/postgres/series-order.js";
import {
  heldProductRemovals,
  recordProductRemovals,
} from "../../shared/product-removal-confirmation.js";
import type { ProductAccessHolders } from "../../ports/product-access-holders.js";
export interface MaterialMembership {
  readonly seriesId: string;
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
    ).map(({ seriesId, ordinal }) => ({ seriesId, ordinal }));
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
        select: { seriesId: true },
      })
    ).map((row) => row.seriesId);
  }
  async assignSelected(
    materialId: string,
    selectedIds: readonly string[],
    handle: TransactionHandle,
  ): Promise<readonly MaterialMembership[]> {
    return appendSelectedSeriesMemberships(
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
    return lockMaterialSeries(
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
    await lockMaterialSeries(transaction, materialId, selectedIds);
    const current = await transaction.productMembership.findMany({
      where: { materialId },
      select: { seriesId: true },
    });
    const before = new Set(current.map(({ seriesId }) => seriesId));
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
        ? `/metadata/seriesIds/${String(selectedIds.indexOf(product.id))}`
        : "/metadata/seriesIds",
    }));
  }
  async replace(
    materialId: string,
    memberships: readonly MaterialMembership[],
    handle: TransactionHandle,
  ): Promise<void> {
    const transaction = productsTransaction(handle);
    const selected = memberships.map((entry) => entry.seriesId);
    const current = await transaction.productMembership.findMany({
      where: { materialId },
      select: { seriesId: true },
    });
    await transaction.productMembership.deleteMany({
      where: { materialId, seriesId: { notIn: selected } },
    });
    const existing = new Set(current.map((entry) => entry.seriesId));
    const added = selected.filter((id) => !existing.has(id));
    if (added.length > 0)
      await transaction.productMembership.createMany({
        data: added.map((seriesId) => ({ materialId, seriesId })),
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
          seriesId: entry.seriesId,
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
    await lockMaterialSeries(
      tx,
      materialId,
      memberships.map((entry) => entry.seriesId),
    );
    const current = new Set(
      (
        await tx.productMembership.findMany({
          where: { materialId },
          select: { seriesId: true },
        })
      ).map((entry) => entry.seriesId),
    );
    const products = await tx.product.findMany({
      where: { id: { in: memberships.map((entry) => entry.seriesId) } },
      select: { id: true, archivedAt: true },
    });
    const known = new Map(products.map((product) => [product.id, product]));
    const issues = memberships.flatMap((entry, index) =>
      !known.has(entry.seriesId)
        ? [
            {
              code: "series_not_found",
              path: `/metadata/seriesMemberships/${index}/seriesId`,
            },
          ]
        : known.get(entry.seriesId)?.archivedAt !== null &&
            !current.has(entry.seriesId)
          ? [
              {
                code: "series_archived",
                path: `/metadata/seriesMemberships/${index}/seriesId`,
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
