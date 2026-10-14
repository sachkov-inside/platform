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
    return (await this.resolveMany([input]))[0] ?? [];
  }

  async resolveMany(inputs: readonly unknown[]) {
    const scopes = inputs.map((input) => coverageSchema.parse(input));
    const productIds = [
      ...new Set(scopes.flatMap((scope) => scope.productIds)),
    ];
    const materialIds = [
      ...new Set(scopes.flatMap((scope) => scope.materialIds)),
    ];
    const wholePlatform = scopes.some((scope) => scope.wholePlatform === true);
    const rows: z.infer<typeof entriesSchema> = [];
    const chunkSize = 500;
    for (
      let offset = 0;
      offset <
      Math.max(productIds.length, materialIds.length, wholePlatform ? 1 : 0);
      offset += chunkSize
    ) {
      rows.push(
        ...entriesSchema.parse(
          await this.prisma.$queryRaw(Prisma.sql`
        SELECT 'product' AS kind, id, name AS title, CASE WHEN archived_at IS NULL THEN slug ELSE NULL END AS slug, archived_at IS NULL AS available
          FROM materials.series WHERE (${wholePlatform && offset === 0}::boolean AND archived_at IS NULL) OR id = ANY(${productIds.slice(offset, offset + chunkSize)}::uuid[])
        UNION ALL
        SELECT 'material' AS kind, id, coalesce(title, 'Материал без названия') AS title,
          CASE WHEN publication_state = 'published' THEN slug ELSE NULL END AS slug, publication_state = 'published' AS available
          FROM materials.materials WHERE id = ANY(${materialIds.slice(offset, offset + chunkSize)}::uuid[])
      `),
        ),
      );
    }
    const byKey = new Map(rows.map((row) => [`${row.kind}:${row.id}`, row]));
    const currentProducts = [...byKey.values()].filter(
      (row) => row.kind === "product" && row.available,
    );
    return scopes.map((scope) => {
      // Whole-platform scope includes each current Product, including ones added after assignment.
      const productItems =
        scope.wholePlatform === true
          ? currentProducts.map((row) => ({
              id: row.id,
              kind: "product" as const,
            }))
          : scope.productIds.map((id) => ({ id, kind: "product" as const }));
      return [
        ...productItems,
        ...scope.materialIds.map((id) => ({ id, kind: "material" as const })),
      ].map(
        (item) =>
          byKey.get(`${item.kind}:${item.id.toLowerCase()}`) ?? {
            ...item,
            title: "Позиция временно недоступна",
            slug: null,
            available: false,
          },
      );
    });
  }
}
