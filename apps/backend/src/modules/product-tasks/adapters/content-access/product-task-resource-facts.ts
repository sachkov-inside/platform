import { z } from "zod";

import { taskAccessSchema } from "../../domain/task-definition.js";

import type { ProductTasksPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type {
  ProductTaskResourceFacts,
  ProductTaskResourceFactsAdapter,
} from "../../../content-access/index.js";

/** Product Tasks answer the Content Access port with their access class, Product and publication. */
export function assembleProductTaskResourceFacts(
  prisma: Pick<ProductTasksPrismaClient, "productTask">,
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
    return rows.map((row) => ({
      taskId: row.id,
      access: taskAccessSchema.parse(row.access),
      productId: row.productId,
      published: row.publicationState === "published",
      version: row.currentVersion,
    }));
  }
  return Object.freeze({
    findMany,
    findOne: async (taskId: string) => (await findMany([taskId]))[0] ?? null,
  });
}
