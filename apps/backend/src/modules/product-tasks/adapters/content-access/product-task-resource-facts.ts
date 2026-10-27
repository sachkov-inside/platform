import type { ProductDiscovery } from "../../../products/index.js";
import { z } from "zod";

import { taskAccessSchema } from "../../domain/task-definition.js";

import type { ProductTasksPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type {
  ProductTaskResourceFacts,
  ProductTaskResourceFactsAdapter,
} from "../../../content-access/index.js";

/** Product Tasks answer Content Access with publication/access and the owning Product archive fact. */
export function assembleProductTaskResourceFacts(
  prisma: Pick<ProductTasksPrismaClient, "productTask">,
  products: Pick<ProductDiscovery, "metadata">,
): ProductTaskResourceFactsAdapter {
  async function findMany(
    taskIds: readonly string[],
  ): Promise<readonly ProductTaskResourceFacts[]> {
    const ids = taskIds.filter((id) => z.uuid().safeParse(id).success);
    if (ids.length === 0) return [];
    const rows = await prisma.productTask.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        access: true,
        productId: true,
        publicationState: true,
        currentVersion: true,
      },
    });
    if (rows.length === 0) return [];
    const states = new Map(
      (
        await products.metadata({
          ids: [...new Set(rows.map((row) => row.productId))],
        })
      ).map((product) => [product.id, product.archivedAt !== null]),
    );
    return rows.flatMap((row) => {
      const archived = states.get(row.productId);
      return archived === undefined
        ? []
        : [
            {
              taskId: row.id,
              access: taskAccessSchema.parse(row.access),
              productId: row.productId,
              archived,
              published: row.publicationState === "published",
              version: row.currentVersion,
            },
          ];
    });
  }
  return Object.freeze({
    findMany,
    findOne: async (taskId: string) => (await findMany([taskId]))[0] ?? null,
  });
}
