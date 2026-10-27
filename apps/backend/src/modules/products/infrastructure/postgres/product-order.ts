import { loadCatalogueMemberships } from "./catalogue-memberships.js";
import {
  Prisma,
  type ProductsPrisma,
  type ProductsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import type { ProductProgrammePlacement } from "../../shared/product-chapters.js";
import { z } from "zod";
interface ProductMembership {
  readonly productId: string;
  readonly ordinal: number;
}
import type { ProductChapterEntry } from "../../shared/product-order-version.js";
type MaterialId = string;
import type { ProductMaterials } from "../../ports/product-materials.js";
import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);

export interface ProductChapterSnapshot {
  readonly supplementaryMaterialIds?: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly ordinal: number;
  readonly summary: string;
}

export interface ProductOrderSnapshot {
  readonly programmePlacements: readonly ProductProgrammePlacement[];
  readonly archived: boolean;
  readonly chapters: readonly ProductChapterSnapshot[];
  readonly items: readonly {
    readonly chapterId: string | null;
    readonly materialId: string;
    readonly ordinal: number;
    readonly stepGroup: string | null;
    readonly publicationState: "draft" | "published" | "unpublished";
    readonly title: string | null;
  }[];
  readonly name: string;
  readonly productId: string;
}

export async function loadProductOrderSnapshot(
  prisma: ProductsPrisma,
  productId: string,
  materialsOwner: ProductMaterials,
): Promise<ProductOrderSnapshot | undefined> {
  const [product, memberships, chapters] = await Promise.all([
    prisma.product.findUnique({
      where: { id: productId },
      select: {
        archivedAt: true,
        id: true,
        name: true,
      },
    }),
    loadCatalogueMemberships(prisma, { productIds: [productId] }),
    prisma.productChapter.findMany({
      where: { productId: productId },
      orderBy: [{ ordinal: "asc" }, { id: "asc" }],
      select: { id: true, name: true, ordinal: true, summary: true },
    }),
  ]);
  if (product === null) {
    return undefined;
  }
  const materials = await materialsOwner.load(
    memberships.map((entry) => entry.materialId),
    transactionHandle(prisma),
  );
  const materialById = new Map(
    materials.map((material) => [material.id, material]),
  );
  const programmePlacements = await prisma.productProgrammePlacement.findMany({
    where: { productId: productId },
    orderBy: { ordinal: "asc" },
    select: { id: true, materialId: true, chapterId: true, stepGroup: true },
  });
  const supplements = await prisma.productChapterSupplementaryMaterial.findMany(
    { where: { productId: productId }, orderBy: { ordinal: "asc" } },
  );
  return {
    programmePlacements,
    archived: product.archivedAt !== null,
    chapters: chapters.map((chapter) => {
      const ids = supplements
        .filter((entry) => entry.chapterId === chapter.id)
        .map((entry) => entry.materialId);
      return ids.length === 0
        ? chapter
        : { ...chapter, supplementaryMaterialIds: ids };
    }),
    items: memberships
      .slice()
      .sort((left, right) =>
        left.ordinal !== right.ordinal
          ? left.ordinal - right.ordinal
          : left.materialId.localeCompare(right.materialId),
      )
      .map(({ chapterId, materialId, ordinal, stepGroup }) => {
        const material = materialById.get(materialId);
        if (material === undefined) {
          throw new TypeError(
            "Product membership references a missing Material",
          );
        }
        return {
          chapterId,
          materialId,
          ordinal,
          stepGroup,
          publicationState: publicationStateSchema.parse(
            material.publicationState,
          ),
          title: material.title,
        };
      }),
    name: product.name,
    productId: product.id,
  };
}

export async function appendSelectedProductMemberships(
  transaction: ProductsPrismaTransaction,
  materialId: MaterialId,
  selectedProductIds: readonly string[],
): Promise<readonly ProductMembership[]> {
  const membershipProductIds = await transaction.productMembership.findMany({
    where: { materialId },
    select: { productId: true },
  });
  await lockProduct(transaction, [
    ...new Set([
      ...selectedProductIds,
      ...membershipProductIds.map(({ productId }) => productId),
    ]),
  ]);

  const currentMemberships = await loadCatalogueMemberships(transaction, {
    materialId,
  });
  const currentByProduct = new Map(
    currentMemberships.map((membership) => [membership.productId, membership]),
  );
  const programme = await transaction.productProgrammePlacement.findMany({
    where: { productId: { in: [...selectedProductIds] } },
    select: { productId: true, ordinal: true },
  });
  const maximumByProduct = new Map(
    selectedProductIds.map((productId) => [
      productId,
      Math.max(
        0,
        ...programme
          .filter((entry) => entry.productId === productId)
          .map((entry) => entry.ordinal),
      ),
    ]),
  );
  return selectedProductIds.map((productId) => {
    const current = currentByProduct.get(productId);
    return current === undefined
      ? {
          productId,
          ordinal: (maximumByProduct.get(productId) ?? 0) + 1,
        }
      : { productId: current.productId, ordinal: current.ordinal };
  });
}

export async function lockProduct(
  transaction: ProductsPrismaTransaction,
  productIds: readonly string[],
): Promise<void> {
  if (productIds.length === 0) {
    return;
  }
  await transaction.$queryRaw(
    Prisma.sql`
      select id
      from products.products
      where id in (${Prisma.join([...productIds].sort())})
      order by id
      for update
    `,
  );
}

export async function lockMaterialProduct(
  transaction: ProductsPrismaTransaction,
  materialId: MaterialId,
  selectedProductIds: readonly string[] = [],
): Promise<void> {
  const memberships = await transaction.productMembership.findMany({
    where: { materialId },
    select: { productId: true },
  });
  await lockProduct(transaction, [
    ...new Set([
      ...selectedProductIds,
      ...memberships.map(({ productId }) => productId),
    ]),
  ]);
}

export async function replaceProductComposition(
  transaction: ProductsPrismaTransaction,
  materialsOwner: ProductMaterials,
  {
    chapters,
    productId,
    orderedMaterialIds,
    programmePlacements,
  }: {
    readonly chapterAssignments: Readonly<Record<string, string>>;
    readonly chapters: readonly ProductChapterEntry[];
    readonly productId: string;
    readonly orderedMaterialIds: readonly string[];
    readonly stepGroups: Readonly<Record<string, string>>;
    readonly programmePlacements: readonly ProductProgrammePlacement[];
  },
): Promise<void> {
  const previousMemberships = await transaction.productMembership.findMany({
    where: { productId: productId },
    select: { materialId: true },
  });
  await transaction.productMembership.deleteMany({
    where: { productId: productId },
  });
  await replaceProductChapters(transaction, productId, chapters);
  if (orderedMaterialIds.length > 0) {
    await transaction.productMembership.createMany({
      data: orderedMaterialIds.map((materialId) => ({
        materialId,
        productId: productId,
      })),
    });
  }

  await transaction.productProgrammePlacement.deleteMany({
    where: { productId },
  });
  if (programmePlacements.length > 0)
    await transaction.productProgrammePlacement.createMany({
      data: programmePlacements.map((placement, index) => ({
        ...placement,
        productId,
        ordinal: index + 1,
      })),
    });
  await transaction.productChapterSupplementaryMaterial.deleteMany({
    where: { productId },
  });

  const supplements = chapters.flatMap((chapter) =>
    (chapter.supplementaryMaterialIds ?? []).map((materialId, index) => ({
      chapterId: chapter.id,
      productId,
      materialId,
      ordinal: index + 1,
    })),
  );
  if (supplements.length > 0)
    await transaction.productChapterSupplementaryMaterial.createMany({
      data: supplements,
    });

  await transaction.publishedMaterialProductMembership.deleteMany({
    where: { productId: productId },
  });
  const published = (
    await materialsOwner.load(
      orderedMaterialIds,
      transactionHandle(transaction),
    )
  ).filter((material) => material.publicationState === "published");
  const publishedIds = new Set(published.map(({ id }) => id));
  const publishedMemberships = orderedMaterialIds.flatMap((materialId) =>
    publishedIds.has(materialId) ? [{ materialId, productId: productId }] : [],
  );
  if (publishedMemberships.length > 0) {
    await transaction.publishedMaterialProductMembership.createMany({
      data: publishedMemberships,
    });
  }
  await materialsOwner.refreshSearch(
    [
      ...new Set([
        ...previousMemberships.map(({ materialId }) => materialId),
        ...orderedMaterialIds,
      ]),
    ],
    transactionHandle(transaction),
  );
}

/**
 * Chapters keep their identity across renames and reordering, so kept rows are updated in place.
 * Removing a chapter detaches its Materials through the membership foreign key; it never deletes
 * a Material. The (product_id, ordinal) constraint is deferred, so positions may swap inside the
 * transaction.
 */
async function replaceProductChapters(
  transaction: ProductsPrismaTransaction,
  productId: string,
  chapters: readonly ProductChapterEntry[],
): Promise<void> {
  const existing = await transaction.productChapter.findMany({
    where: { productId },
    select: { id: true },
  });
  const kept = new Set(chapters.map(({ id }) => id));
  const removed = existing.flatMap(({ id }) => (kept.has(id) ? [] : [id]));
  if (removed.length > 0) {
    await transaction.productChapter.deleteMany({
      where: { productId, id: { in: removed } },
    });
  }
  const known = new Set(existing.map(({ id }) => id));
  const updatedAt = new Date();
  for (const [index, { id, name, summary }] of chapters.entries()) {
    const ordinal = index + 1;
    if (known.has(id)) {
      await transaction.productChapter.update({
        where: { id },
        data: { name, ordinal, summary, updatedAt },
      });
    } else {
      await transaction.productChapter.create({
        data: { id, productId, name, ordinal, summary },
      });
    }
  }
}
