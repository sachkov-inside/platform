import { z } from "zod";
import {
  coverageEntrySchema,
  coverageSchema,
} from "@inside/access-capabilities";
import {
  Prisma,
  type MaterialsPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

const entriesSchema = z.array(coverageEntrySchema);
const maximumCatalogEntries = 2000;
/** Metadata only. Knowing a title never authorizes its body, media or artifacts. */
export class CoverageCatalog {
  constructor(private readonly prisma: MaterialsPrismaClient) {}
  async list() {
    const rows = entriesSchema.parse(
      await this.prisma.$queryRaw(Prisma.sql`
      SELECT 'product' AS kind, id, name AS title, slug, archived_at IS NULL AS available FROM materials.series
      UNION ALL
      SELECT 'material' AS kind, id, coalesce(title, 'Материал без названия') AS title,
        CASE WHEN publication_state = 'published' THEN slug ELSE NULL END AS slug,
        publication_state = 'published' AS available FROM materials.materials
      ORDER BY kind, title, id LIMIT ${maximumCatalogEntries + 1}
    `),
    );
    if (rows.length > maximumCatalogEntries)
      throw new Error("Content scope catalog exceeds supported size");
    return rows;
  }
  async resolve(input: unknown) {
    const scope = coverageSchema.parse(input);
    const rows = entriesSchema.parse(
      await this.prisma.$queryRaw(Prisma.sql`
      SELECT 'product' AS kind, id, name AS title, CASE WHEN archived_at IS NULL THEN slug ELSE NULL END AS slug, archived_at IS NULL AS available
        FROM materials.series WHERE (${scope.wholePlatform === true}::boolean AND archived_at IS NULL) OR id = ANY(${scope.productIds}::uuid[])
      UNION ALL
      SELECT 'material' AS kind, id, coalesce(title, 'Материал без названия') AS title,
        CASE WHEN publication_state = 'published' THEN slug ELSE NULL END AS slug, publication_state = 'published' AS available
        FROM materials.materials WHERE id = ANY(${scope.materialIds}::uuid[])
    `),
    );
    // Состав «все продукты» называет каждый действующий продукт, включая добавленные после назначения.
    const productItems =
      scope.wholePlatform === true
        ? rows
            .filter((row) => row.kind === "product")
            .map((row) => ({ id: row.id, kind: "product" as const }))
        : scope.productIds.map((id) => ({ id, kind: "product" as const }));
    return [
      ...productItems,
      ...scope.materialIds.map((id) => ({ id, kind: "material" as const })),
    ].map(
      (item) =>
        rows.find((row) => row.id === item.id && row.kind === item.kind) ?? {
          ...item,
          title: "Позиция временно недоступна",
          slug: null,
          available: false,
        },
    );
  }
}
