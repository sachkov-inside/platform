import { z } from "zod";

import type { GuideTasksPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type {
  GuideTaskResourceFacts,
  GuideTaskResourceFactsAdapter,
} from "../../../content-access/index.js";

const accessSchema = z.enum(["free", "membership"]);

/** Guide Tasks answer the Content Access port with their access class, Guide and publication. */
export function assembleGuideTaskResourceFacts(
  prisma: Pick<GuideTasksPrismaClient, "guideTask">,
): GuideTaskResourceFactsAdapter {
  async function findMany(
    taskIds: readonly string[],
  ): Promise<readonly GuideTaskResourceFacts[]> {
    const ids = taskIds.filter((id) => z.uuid().safeParse(id).success);
    if (ids.length === 0) return [];
    const rows = await prisma.guideTask.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        access: true,
        guideId: true,
        publicationState: true,
        currentVersion: true,
      },
    });
    return rows.map((row) => ({
      taskId: row.id,
      access: accessSchema.parse(row.access),
      guideId: row.guideId,
      published: row.publicationState === "published",
      version: row.currentVersion,
    }));
  }
  return Object.freeze({
    findMany,
    findOne: async (taskId: string) => (await findMany([taskId]))[0] ?? null,
  });
}
