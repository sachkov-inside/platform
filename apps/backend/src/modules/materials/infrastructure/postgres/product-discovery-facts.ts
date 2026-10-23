import { Prisma } from "../../../../infrastructure/prisma/index.js";
import type { ProductDiscovery } from "../../../products/index.js";

export type DiscoverySnapshot = Awaited<
  ReturnType<ProductDiscovery["snapshot"]>
>;

/** Query-local values, received through Products. No Product table or SQL crosses the interface. */
export function discoveryRelations(snapshot: DiscoverySnapshot) {
  const products = snapshot.products.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    summary: row.summary,
    archived_at: row.archivedAt,
    cover_id: row.coverId,
  }));
  const memberships = snapshot.memberships.map((row) => ({
    series_id: row.seriesId,
    material_id: row.materialId,
    ordinal: row.ordinal,
    chapter_id: row.chapterId,
    step_group: row.stepGroup,
  }));
  const published = snapshot.publishedMemberships.map((row) => ({
    series_id: row.seriesId,
    material_id: row.materialId,
    ordinal: row.ordinal,
  }));
  return {
    products: Prisma.sql`select * from jsonb_to_recordset(${JSON.stringify(products)}::jsonb) as facts(id uuid, name text, slug text, summary text, archived_at timestamptz, cover_id uuid)`,
    memberships: Prisma.sql`select * from jsonb_to_recordset(${JSON.stringify(memberships)}::jsonb) as facts(series_id uuid, material_id uuid, ordinal integer, chapter_id uuid, step_group text)`,
    publishedMemberships: Prisma.sql`select * from jsonb_to_recordset(${JSON.stringify(published)}::jsonb) as facts(series_id uuid, material_id uuid, ordinal integer)`,
  };
}
