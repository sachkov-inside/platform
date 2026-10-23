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
import { randomUUID } from "node:crypto";
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
      handle === undefined ? this.prisma : productsTransaction(handle)
    ).productMembership.findMany({
      where: { materialId },
      select: { seriesId: true, ordinal: true },
      orderBy: { seriesId: "asc" },
    });
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
    const previousMemberships = await transaction.productMembership.findMany({
      where: { materialId },
      select: { chapterId: true, seriesId: true, stepGroup: true },
    });
    // A full Material Save keeps the Product-owned placement of every retained membership.
    const placements = new Map(
      previousMemberships.map(({ chapterId, seriesId, stepGroup }) => [
        seriesId,
        { chapterId, stepGroup },
      ]),
    );
    const retainedProducts = memberships.map((entry) => entry.seriesId);
    const retainedProgramme =
      await transaction.productProgrammePlacement.findMany({
        where: { materialId, productId: { in: retainedProducts } },
      });
    const retainedSupplements =
      await transaction.productChapterSupplementaryMaterial.findMany({
        where: { materialId, productId: { in: retainedProducts } },
      });
    await transaction.productMembership.deleteMany({ where: { materialId } });
    if (memberships.length > 0) {
      await transaction.productMembership.createMany({
        data: memberships.map(({ seriesId, ordinal }) => ({
          materialId,
          seriesId,
          ordinal,
          chapterId: placements.get(seriesId)?.chapterId ?? null,
          stepGroup: placements.get(seriesId)?.stepGroup ?? null,
        })),
      });
    }
    if (retainedProgramme.length > 0)
      await transaction.productProgrammePlacement.createMany({
        data: retainedProgramme,
      });
    if (retainedSupplements.length > 0)
      await transaction.productChapterSupplementaryMaterial.createMany({
        data: retainedSupplements,
      });
    const previousProducts = new Set(
      previousMemberships.map((entry) => entry.seriesId),
    );
    for (const productId of retainedProducts.filter(
      (id) => !previousProducts.has(id),
    )) {
      const product = await transaction.product.findUnique({
        where: { id: productId },
        select: { programmeExplicit: true },
      });
      if (product?.programmeExplicit === true) continue;
      if (
        (await transaction.productChapter.findFirst({
          where: { productId },
          select: { id: true },
        })) !== null
      )
        continue;
      const maximum = await transaction.productProgrammePlacement.aggregate({
        where: { productId },
        _max: { ordinal: true },
      });
      await transaction.productProgrammePlacement.create({
        data: {
          id: randomUUID(),
          productId,
          materialId,
          chapterId: null,
          ordinal: (maximum._max.ordinal ?? 0) + 1,
          stepGroup: null,
        },
      });
    }
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
        data: memberships.map((entry) => ({ ...entry, materialId })),
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
    const occupied = await tx.productMembership.findMany({
      where: {
        seriesId: { in: memberships.map((entry) => entry.seriesId) },
        materialId: { not: materialId },
      },
      select: { seriesId: true, ordinal: true },
    });
    const conflict = memberships.find((entry) =>
      occupied.some(
        (other) =>
          other.seriesId === entry.seriesId && other.ordinal === entry.ordinal,
      ),
    );
    return { ...(conflict === undefined ? {} : { conflict }), issues };
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
