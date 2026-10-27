import { z } from "zod";
import {
  Prisma,
  type MaterialsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type { ProductMaterialReading } from "../../../products/index.js";
import { materialsTransaction } from "../transaction.js";
const rowsSchema = z.array(
  z.object({
    id: z.uuid(),
    sourceId: z.string().nullable(),
    slug: z.string().nullable(),
    title: z.string().nullable(),
    topicId: z.uuid().nullable(),
    hasModeVariants: z.boolean(),
  }),
);
export function assembleProductMaterialReading(
  prisma: MaterialsPrismaClient,
): ProductMaterialReading {
  return {
    async read(filter, handle) {
      const values = "ids" in filter ? filter.ids : filter.sourceIds;
      if (values.length === 0) return [];
      const transaction =
        handle === undefined ? prisma : materialsTransaction(handle);
      const where =
        "ids" in filter
          ? Prisma.sql`material.id = any(${[...values]}::uuid[])`
          : Prisma.sql`material.source_id = any(${[...values]}::text[])`;
      const rows = rowsSchema.parse(
        await transaction.$queryRaw(Prisma.sql`
        select material.id, material.source_id as "sourceId", published.slug, published.title,
          published.topic_id as "topicId", coalesce(published.has_mode_variants, false) as "hasModeVariants"
        from materials.materials material
        left join materials.published_materials published on published.material_id = material.id and material.publication_state = 'published'
        where ${where}
      `),
      );
      return rows.map(({ slug, title, ...row }) => ({
        ...row,
        published: slug === null || title === null ? null : { slug, title },
      }));
    },
  };
}
