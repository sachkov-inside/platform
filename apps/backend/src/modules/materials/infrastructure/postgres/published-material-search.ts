import type { ProductDiscovery } from "../../../products/index.js";
import { transactionHandle } from "../../../../infrastructure/prisma/index.js";
import { discoveryRelations } from "./product-discovery-facts.js";
import { materialFormatsSql } from "./material-formats.js";
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
  discovery: Pick<ProductDiscovery, "snapshot">,
): Promise<void> {
  if (scope.kind === "materials" && scope.materialIds.length === 0) return;
  const relations = discoveryRelations(
    await discovery.snapshot(transactionHandle(transaction)),
  );
  await transaction.$executeRaw(Prisma.sql`
    update materials.published_materials as publication
    set public_search_text = concat_ws(
      ' ',
      topic.name,
      topic.summary,
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
          select string_agg(
            concat_ws(' ', series.name, series.summary),
            ' ' order by series.name
          )
          from (${relations.publishedMemberships}) as membership
          join (${relations.products}) as series on series.id = membership.series_id
          where membership.material_id = publication.material_id
        ),
        ''
      )
    )
    from materials.topics as topic, (${materialFormatsSql}) as format(id, slug, name)
    where ${searchScopeSql(scope, relations)}
      and topic.id = publication.topic_id
      and format.id = publication.format_id
  `);
}

function searchScopeSql(
  scope: PublishedMaterialSearchScope,
  relations: ReturnType<typeof discoveryRelations>,
): Prisma.Sql {
  switch (scope.kind) {
    case "materials":
      return Prisma.sql`publication.material_id in (${Prisma.join(scope.materialIds)})`;
    case "series":
      return Prisma.sql`exists (
        select 1
        from (${relations.publishedMemberships}) as membership
        where membership.material_id = publication.material_id
          and membership.series_id = ${scope.seriesId}::uuid
      )`;
    case "topic":
      return Prisma.sql`publication.topic_id = ${scope.topicId}::uuid`;
  }
}
