import { z } from "zod";

import {
  Prisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import { Material } from "../../domain/material.js";
import { materialId, type MaterialId } from "../../domain/material-identifiers.js";

const lockedMaterialRowsSchema = z.array(
  z.object({
    id: z.uuid(),
    slug: z.string().nullable(),
    publication_state: z.enum(["draft", "published", "unpublished"]),
    content_version: z.coerce.number().int().positive(),
    first_published_at: z.coerce.date().nullable(),
    published_at: z.coerce.date().nullable(),
    published_by: z.uuid().nullable(),
  }),
);

export interface LockedMaterial {
  readonly lifecycle: Material;
  readonly publishedBy: string | null;
}

export async function lockMaterialForLifecycleChange(
  transaction: MaterialsPrismaTransaction,
  materialIdValue: MaterialId,
): Promise<LockedMaterial | undefined> {
  const rows = lockedMaterialRowsSchema.parse(
    await transaction.$queryRaw(Prisma.sql`
      select
        id,
        slug,
        publication_state,
        content_version,
        first_published_at,
        published_at,
        published_by
      from materials.materials
      where id = ${materialIdValue}::uuid
      for update
    `),
  );
  const row = rows[0];
  return row === undefined
    ? undefined
    : {
        lifecycle: Material.restore({
          id: materialId(row.id),
          slug: row.slug,
          publicationState: row.publication_state,
          contentVersion: row.content_version,
          firstPublishedAt: row.first_published_at,
          publishedAt: row.published_at,
        }),
        publishedBy: row.published_by,
      };
}
