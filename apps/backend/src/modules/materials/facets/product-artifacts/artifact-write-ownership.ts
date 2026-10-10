import type { MaterialsPrismaTransaction } from "../../../../infrastructure/prisma/index.js";
import {
  checkContentWrite,
  contentWriter,
  type ContentWriteTarget,
} from "../../domain/content-write-policy.js";
import { lockSeries } from "../../infrastructure/postgres/series-order.js";
import type { ProductArtifactError } from "./product-artifacts.js";

/** Load ownership inside the mutation transaction, including old and proposed placements. */
export async function checkArtifactWrite(
  transaction: MaterialsPrismaTransaction,
  artifactId: string | null,
  productIds: readonly string[] = [],
): Promise<ProductArtifactError | null> {
  const targets: ContentWriteTarget[] = [];
  let placedIds: readonly string[] = [];
  if (artifactId !== null) {
    await transaction.$executeRaw`select id from materials.product_artifacts where id = ${artifactId}::uuid for update`;
    const artifact = await transaction.productArtifact.findUnique({
      where: { id: artifactId },
      include: { placements: true },
    });
    if (artifact === null) return { code: "artifact_not_found" };
    targets.push({
      kind: "artifact",
      sourceId: artifact.sourceId,
      path: "/artifactId",
    });
    placedIds = artifact.placements.map(({ productId }) => productId);
  }
  const ids = [...new Set([...placedIds, ...productIds])];
  await lockSeries(transaction, ids);
  const products = await transaction.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, sourceId: true },
  });
  if (products.length !== ids.length) return { code: "product_not_found" };
  targets.push(
    ...products.map((product) => ({
      kind: "product" as const,
      sourceId: product.sourceId,
      path: "/productIds",
    })),
  );
  const error = checkContentWrite(contentWriter(), targets);
  return error === null ? null : { code: "forbidden" };
}
