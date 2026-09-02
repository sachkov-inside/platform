import {
  Prisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";

export type PublishedMaterialSearchScope =
  | { readonly kind: "materials"; readonly materialIds: readonly string[] }
  | { readonly kind: "series"; readonly seriesId: string }
  | { readonly kind: "topic"; readonly topicId: string };

export async function refreshPublishedMaterialSearchProjections(
  transaction: MaterialsPrismaTransaction,
  scope: PublishedMaterialSearchScope,
): Promise<void> {
  if (scope.kind === "materials" && scope.materialIds.length === 0) return;
  await transaction.$executeRaw(Prisma.sql`
    update materials.published_materials as publication
    set public_search_text = concat_ws(
      ' ',
      topic.name,
      format.name,
      coalesce(
        (
          select string_agg(tag.name, ' ' order by tag.normalized_name)
          from materials.published_material_tags as membership
          join materials.tags as tag on tag.id = membership.tag_id
          where membership.material_id = publication.material_id
        ),
        ''
      ),
      coalesce(
        (
          select string_agg(series.name, ' ' order by series.name)
          from materials.published_material_series_memberships as membership
          join materials.series as series on series.id = membership.series_id
          where membership.material_id = publication.material_id
        ),
        ''
      )
    )
    from materials.topics as topic, materials.formats as format
    where ${searchScopeSql(scope)}
      and topic.id = publication.topic_id
      and format.id = publication.format_id
  `);
}

function searchScopeSql(scope: PublishedMaterialSearchScope): Prisma.Sql {
  switch (scope.kind) {
    case "materials":
      return Prisma.sql`publication.material_id in (${Prisma.join(scope.materialIds)})`;
    case "series":
      return Prisma.sql`exists (
        select 1
        from materials.published_material_series_memberships as membership
        where membership.material_id = publication.material_id
          and membership.series_id = ${scope.seriesId}::uuid
      )`;
    case "topic":
      return Prisma.sql`publication.topic_id = ${scope.topicId}::uuid`;
  }
}
