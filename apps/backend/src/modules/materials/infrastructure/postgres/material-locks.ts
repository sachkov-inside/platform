import {
  Prisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import { Material } from "../../domain/material.js";
import {
  materialId,
  materialRevisionId,
  type MaterialId,
} from "../../domain/material-identifiers.js";

const lockedMaterialRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    current_draft_revision_id: z.uuid(),
    current_published_revision_id: z.uuid().nullable(),
  }),
);

export async function lockMaterialForLifecycleChange(
  transaction: MaterialsPrismaTransaction,
  materialIdValue: MaterialId,
): Promise<Material | undefined> {
  const rows = lockedMaterialRowsSchema.parse(
    await transaction.$queryRaw(Prisma.sql`
      select id, current_draft_revision_id, current_published_revision_id
      from materials.materials
      where id = ${materialIdValue}::uuid
      for update
    `),
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : Material.restore({
        id: materialId(row.id),
        currentDraftRevisionId: materialRevisionId(
          row.current_draft_revision_id,
        ),
        currentPublishedRevisionId:
          row.current_published_revision_id === null
            ? null
            : materialRevisionId(row.current_published_revision_id),
      });
}
