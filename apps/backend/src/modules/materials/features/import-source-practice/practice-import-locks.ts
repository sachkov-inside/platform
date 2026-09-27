import { z } from "zod";
import {
  Prisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";

export async function lockPracticeMaterial(
  transaction: MaterialsPrismaTransaction,
  materialId: string,
) {
  const rows = z
    .array(
      z.object({
        id: z.uuid(),
        source_id: z.string().nullable(),
        source_revision: z.string().nullable(),
        content_version: z.coerce
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER),
        publication_state: z.enum(["draft", "published", "unpublished"]),
      }),
    )
    .parse(
      await transaction.$queryRaw(Prisma.sql`
    select id, source_id, source_revision, content_version, publication_state
    from materials.materials where id = ${materialId}::uuid for update
  `),
    );
  return rows[0];
}
