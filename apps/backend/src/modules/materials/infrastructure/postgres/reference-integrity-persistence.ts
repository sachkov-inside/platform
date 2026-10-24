import type { ProductMemberships } from "../../../products/index.js";
import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { type MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";
import type { MaterialId } from "../../domain/material-identifiers.js";
import type { MaterialMetadata } from "../../domain/material-metadata.js";

export async function findReferenceIssues(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  metadata: MaterialMetadata,
  products: ProductMemberships,
): Promise<readonly { readonly code: string; readonly path: string }[]> {
  const issues: { code: string; path: string }[] = [];
  const currentMaterial = await transaction.material.findUnique({
    where: { id: materialId },
    select: { topicId: true },
  });
  const topic =
    metadata.topicId === null
      ? null
      : await transaction.topic.findUnique({
          where: { id: metadata.topicId },
          select: { archivedAt: true, id: true },
        });
  const tags =
    metadata.tagIds.length === 0
      ? []
      : await transaction.tag.findMany({
          where: { id: { in: [...metadata.tagIds] } },
          select: { id: true },
        });

  if (metadata.topicId !== null && topic === null) {
    issues.push({ code: "topic_not_found", path: "/metadata/topicId" });
  } else if (
    metadata.topicId !== null &&
    topic?.archivedAt !== null &&
    currentMaterial?.topicId !== metadata.topicId
  ) {
    issues.push({ code: "topic_archived", path: "/metadata/topicId" });
  }
  const foundTags = new Set(tags.map(({ id }) => id));
  metadata.tagIds.forEach((tagId, index) => {
    if (!foundTags.has(tagId)) {
      issues.push({ code: "tag_not_found", path: `/metadata/tagIds/${index}` });
    }
  });
  issues.push(
    ...(
      await products.inspectReferences(
        materialId,
        metadata.productMemberships,
        transactionHandle(transaction),
      )
    ).issues,
  );
  return issues.sort((left, right) => left.path.localeCompare(right.path));
}

export async function findProductOrdinalConflict(
  transaction: MaterialsPrismaTransaction,
  materialId: MaterialId,
  metadata: MaterialMetadata,
  products: ProductMemberships,
): Promise<
  { readonly productId: string; readonly ordinal: number } | undefined
> {
  return (
    await products.inspectReferences(
      materialId,
      metadata.productMemberships,
      transactionHandle(transaction),
    )
  ).conflict;
}
