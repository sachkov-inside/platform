import {
  Prisma,
  type MaterialsPrisma,
} from "../../../../../infrastructure/prisma/index.js";
import { z } from "zod";

import type { PublishedMaterialProjectionDto } from "../../../facets/published-material-reader/published-material.contract.js";
import type {
  PublishedMaterialProjectionCursor,
  PublishedMaterialProjectionPageDto,
  PublishedMaterialProjectionSort,
} from "../../../features/list-published-material-projections/list-published-material-projections.contract.js";

interface PublishedMaterialProjectionSearchValues {
  readonly after?: PublishedMaterialProjectionCursor;
  readonly first: number;
  readonly formatSlugs: readonly string[];
  readonly q?: string;
  readonly seriesSlugs: readonly string[];
  readonly sort: PublishedMaterialProjectionSort;
  readonly topicSlugs: readonly string[];
}

export interface PublishedMaterialDiscoveryPage {
  readonly reference: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly hasNext: boolean;
}

const publishedMaterialProjectionRowSchema = z.object({
  material_id: z.uuid(),
  content_version: z.coerce.number().int().positive(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  access: z.enum(["free", "membership"]),
  published_at: z.date(),
  primary_video_id: z.uuid().nullable(),
  topic_id: z.uuid(),
  topic_name: z.string(),
  topic_slug: z.string(),
  format_id: z.uuid(),
  format_name: z.string(),
  format_slug: z.string(),
  tags: z.array(z.object({ id: z.uuid(), name: z.string() })),
  series_memberships: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
      ordinal: z.number().int(),
    }),
  ),
});

const searchedPublishedMaterialProjectionRowSchema =
  publishedMaterialProjectionRowSchema.extend({
    search_rank: z.coerce.number().nonnegative(),
    series_ordinal: z.coerce.number().int().positive().nullable(),
    title_key: z.string(),
  });

const facetOptionSchema = z
  .object({
    count: z.coerce.number().int().nonnegative(),
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

const projectionMetadataRowSchema = z
  .object({
    formats: z.array(facetOptionSchema),
    series: z.array(facetOptionSchema),
    topics: z.array(facetOptionSchema),
    total_count: z.coerce.number().int().nonnegative(),
  })
  .strict();

type PublishedMaterialProjectionRow = z.infer<
  typeof publishedMaterialProjectionRowSchema
>;
type SearchedPublishedMaterialProjectionRow = z.infer<
  typeof searchedPublishedMaterialProjectionRowSchema
>;

export async function selectPublishedMaterialProjectionBySlug(
  prisma: MaterialsPrisma,
  slug: string,
): Promise<PublishedMaterialProjectionDto | undefined> {
  const rows = publishedMaterialProjectionRowSchema.array().parse(
    await prisma.$queryRaw(
      projectionQuery({
        where: Prisma.sql`where publication.slug = ${slug}`,
        limit: Prisma.sql`limit 1`,
      }),
    ),
  );
  return rows[0] === undefined ? undefined : toProjection(rows[0]);
}

export async function selectPublishedMaterialProjectionPage(
  prisma: MaterialsPrisma,
  values: PublishedMaterialProjectionSearchValues,
): Promise<PublishedMaterialProjectionPageDto> {
  const effectiveSort = effectiveProjectionSort(values);
  const searchRank = searchRankSql(values.q);
  const filters = projectionFiltersSql(values);
  const [rawRows, metadata] = await Promise.all([
    prisma.$queryRaw(searchProjectionQuery(values, filters, searchRank)),
    selectProjectionMetadata(prisma, filters),
  ]);
  const rows = searchedPublishedMaterialProjectionRowSchema
    .array()
    .parse(rawRows);
  const visibleRows = rows.slice(0, values.first);
  const lastRow = visibleRows.at(-1);
  const hasNext = rows.length > values.first;
  return {
    continuation:
      hasNext && lastRow !== undefined
        ? toContinuation(lastRow, effectiveSort)
        : null,
    facets: {
      formats: metadata.formats,
      series: metadata.series,
      topics: metadata.topics,
    },
    items: visibleRows.map(toProjection),
    hasNext,
    totalCount: metadata.total_count,
  };
}

function searchProjectionQuery(
  values: PublishedMaterialProjectionSearchValues,
  filters: Prisma.Sql,
  searchRank: Prisma.Sql,
): Prisma.Sql {
  const sort = effectiveProjectionSort(values);
  return Prisma.sql`
    select
      publication.material_id,
      publication.content_version,
      publication.slug,
      publication.title,
      publication.summary,
      publication.access,
      publication.published_at,
      publication.primary_video_id,
      topic.id as topic_id,
      topic.name as topic_name,
      topic.slug as topic_slug,
      format.id as format_id,
      format.name as format_name,
      format.slug as format_slug,
      ${searchRank} as search_rank,
      ${seriesOrdinalSql(sort)} as series_ordinal,
      lower(publication.title) as title_key,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', tag.id, 'name', tag.name)
            order by tag.normalized_name
          )
          from materials.published_material_tags as membership
          join materials.tags as tag on tag.id = membership.tag_id
          where membership.material_id = publication.material_id
        ),
        '[]'::jsonb
      ) as tags,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', series.id,
              'name', series.name,
              'slug', series.slug,
              'ordinal', membership.ordinal
            )
            order by series.name, membership.ordinal
          )
          from materials.published_material_series_memberships as membership
          join materials.series as series on series.id = membership.series_id
          where membership.material_id = publication.material_id
        ),
        '[]'::jsonb
      ) as series_memberships
    from materials.published_materials as publication
    join materials.topics as topic on topic.id = publication.topic_id
    join materials.formats as format on format.id = publication.format_id
    ${seriesSortJoinsSql(values, sort)}
    where ${filters}
      ${cursorSql(values.after, sort, searchRank)}
    ${orderSql(sort)}
    limit ${values.first + 1}
  `;
}

function projectionFiltersSql(
  values: PublishedMaterialProjectionSearchValues,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`true`];
  if (values.q !== undefined) {
    conditions.push(
      Prisma.sql`publication.search_vector @@ ${textSearchQuerySql(values.q)}`,
    );
  }
  if (values.topicSlugs.length > 0) {
    conditions.push(
      Prisma.sql`topic.slug in (${Prisma.join(values.topicSlugs)})`,
    );
  }
  if (values.formatSlugs.length > 0) {
    conditions.push(
      Prisma.sql`format.slug in (${Prisma.join(values.formatSlugs)})`,
    );
  }
  if (values.seriesSlugs.length > 0) {
    conditions.push(Prisma.sql`
      exists (
        select 1
        from materials.published_material_series_memberships as selected_membership
        join materials.series as selected_series
          on selected_series.id = selected_membership.series_id
        where selected_membership.material_id = publication.material_id
          and selected_series.slug in (${Prisma.join(values.seriesSlugs)})
      )
    `);
  }
  return Prisma.join(conditions, " and ");
}

function textSearchQuerySql(q: string): Prisma.Sql {
  return Prisma.sql`(
    websearch_to_tsquery('russian'::regconfig, ${q}) ||
    websearch_to_tsquery('english'::regconfig, ${q}) ||
    websearch_to_tsquery('simple'::regconfig, ${q})
  )`;
}

function searchRankSql(q: string | undefined): Prisma.Sql {
  return q === undefined
    ? Prisma.sql`0::double precision`
    : Prisma.sql`ts_rank_cd(
        publication.search_vector,
        ${textSearchQuerySql(q)},
        32
      )::double precision`;
}

function cursorSql(
  after: PublishedMaterialProjectionSearchValues["after"],
  sort: PublishedMaterialProjectionSort,
  searchRank: Prisma.Sql,
): Prisma.Sql {
  if (after === undefined) {
    return Prisma.empty;
  }
  if (after.kind !== sort) {
    throw new TypeError("Published Material cursor does not match its sort");
  }
  switch (after.kind) {
    case "newest":
      return Prisma.sql`
        and (publication.published_at, publication.material_id)
          < (${new Date(after.publishedAt)}, ${after.materialId}::uuid)
      `;
    case "relevance":
      return Prisma.sql`
        and (${searchRank}, publication.published_at, publication.material_id)
          < (${after.rank}, ${new Date(after.publishedAt)}, ${after.materialId}::uuid)
      `;
    case "series":
      return Prisma.sql`
        and (selected_membership.ordinal, publication.material_id)
          > (${after.ordinal}, ${after.materialId}::uuid)
      `;
    case "title":
      return Prisma.sql`
        and (lower(publication.title), publication.material_id)
          > (${after.title}, ${after.materialId}::uuid)
      `;
  }
}

function orderSql(sort: PublishedMaterialProjectionSort): Prisma.Sql {
  switch (sort) {
    case "newest":
      return Prisma.sql`order by publication.published_at desc, publication.material_id desc`;
    case "relevance":
      return Prisma.sql`order by search_rank desc, publication.published_at desc, publication.material_id desc`;
    case "series":
      return Prisma.sql`order by selected_membership.ordinal, publication.material_id`;
    case "title":
      return Prisma.sql`order by title_key, publication.material_id`;
  }
}

async function selectProjectionMetadata(
  prisma: MaterialsPrisma,
  filters: Prisma.Sql,
): Promise<z.infer<typeof projectionMetadataRowSchema>> {
  const rows = projectionMetadataRowSchema.array().parse(
    await prisma.$queryRaw(Prisma.sql`
      select
        (
          select count(*)::integer
          from materials.published_materials as publication
          join materials.topics as topic on topic.id = publication.topic_id
          join materials.formats as format on format.id = publication.format_id
          where ${filters}
        ) as total_count,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', option.id,
                'name', option.name,
                'slug', option.slug,
                'count', option.count
              )
              order by option.name, option.id
            )
            from (
              select topic.id, topic.name, topic.slug, count(*)::integer as count
              from materials.published_materials as publication
              join materials.topics as topic on topic.id = publication.topic_id
              group by topic.id, topic.name, topic.slug
            ) as option
          ),
          '[]'::jsonb
        ) as topics,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', option.id,
                'name', option.name,
                'slug', option.slug,
                'count', option.count
              )
              order by option.name, option.id
            )
            from (
              select format.id, format.name, format.slug, count(*)::integer as count
              from materials.published_materials as publication
              join materials.formats as format on format.id = publication.format_id
              group by format.id, format.name, format.slug
            ) as option
          ),
          '[]'::jsonb
        ) as formats,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', option.id,
                'name', option.name,
                'slug', option.slug,
                'count', option.count
              )
              order by option.name, option.id
            )
            from (
              select series.id, series.name, series.slug, count(*)::integer as count
              from materials.published_material_series_memberships as membership
              join materials.series as series on series.id = membership.series_id
              group by series.id, series.name, series.slug
            ) as option
          ),
          '[]'::jsonb
        ) as series
    `),
  );
  const row = rows[0];
  if (row === undefined) {
    throw new TypeError("Published Material projection metadata is missing");
  }
  return row;
}

function effectiveProjectionSort(
  values: PublishedMaterialProjectionSearchValues,
): PublishedMaterialProjectionSort {
  return values.sort === "relevance" && values.q === undefined
    ? "newest"
    : values.sort;
}

function seriesOrdinalSql(sort: PublishedMaterialProjectionSort): Prisma.Sql {
  return sort === "series"
    ? Prisma.sql`selected_membership.ordinal`
    : Prisma.sql`null::integer`;
}

function seriesSortJoinsSql(
  values: PublishedMaterialProjectionSearchValues,
  sort: PublishedMaterialProjectionSort,
): Prisma.Sql {
  if (sort !== "series") {
    return Prisma.empty;
  }
  const slug = values.seriesSlugs[0];
  if (slug === undefined || values.seriesSlugs.length !== 1) {
    throw new TypeError("Series order requires exactly one Series filter");
  }
  return Prisma.sql`
    join materials.published_material_series_memberships as selected_membership
      on selected_membership.material_id = publication.material_id
    join materials.series as selected_series
      on selected_series.id = selected_membership.series_id
     and selected_series.slug = ${slug}
  `;
}

function toContinuation(
  row: SearchedPublishedMaterialProjectionRow,
  sort: PublishedMaterialProjectionSort,
): PublishedMaterialProjectionCursor {
  switch (sort) {
    case "newest":
      return {
        kind: sort,
        materialId: row.material_id,
        publishedAt: row.published_at.toISOString(),
      };
    case "relevance":
      return {
        kind: sort,
        materialId: row.material_id,
        publishedAt: row.published_at.toISOString(),
        rank: row.search_rank,
      };
    case "series":
      if (row.series_ordinal === null) {
        throw new TypeError("Series continuation ordinal is missing");
      }
      return {
        kind: sort,
        materialId: row.material_id,
        ordinal: row.series_ordinal,
      };
    case "title":
      return {
        kind: sort,
        materialId: row.material_id,
        title: row.title_key,
      };
  }
}

export async function selectPublishedMaterialProjectionsByTopic(
  prisma: MaterialsPrisma,
  slug: string,
  first: number,
): Promise<PublishedMaterialDiscoveryPage | undefined> {
  const reference = await prisma.topic.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
  if (reference === null) {
    return undefined;
  }
  const rows = publishedMaterialProjectionRowSchema.array().parse(
    await prisma.$queryRaw(
      projectionQuery({
        where: Prisma.sql`where topic.slug = ${slug}`,
        limit: Prisma.sql`limit ${first + 1}`,
      }),
    ),
  );
  return {
    reference,
    items: rows.slice(0, first).map(toProjection),
    hasNext: rows.length > first,
  };
}

export async function selectPublishedMaterialProjectionsBySeries(
  prisma: MaterialsPrisma,
  slug: string,
  first: number,
): Promise<PublishedMaterialDiscoveryPage | undefined> {
  const reference = await prisma.series.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
  if (reference === null) {
    return undefined;
  }
  const rows = publishedMaterialProjectionRowSchema.array().parse(
    await prisma.$queryRaw(
      projectionQuery({
        joins: Prisma.sql`
          join materials.published_material_series_memberships as selected_membership
            on selected_membership.material_id = publication.material_id
          join materials.series as selected_series
            on selected_series.id = selected_membership.series_id
        `,
        where: Prisma.sql`where selected_series.slug = ${slug}`,
        order: Prisma.sql`
          order by selected_membership.ordinal, publication.material_id
        `,
        limit: Prisma.sql`limit ${first + 1}`,
      }),
    ),
  );
  return {
    reference,
    items: rows.slice(0, first).map(toProjection),
    hasNext: rows.length > first,
  };
}

export async function selectRelatedPublishedMaterialProjections(
  prisma: MaterialsPrisma,
  slug: string,
  first: number,
): Promise<PublishedMaterialDiscoveryPage | undefined> {
  const source = await selectPublishedMaterialProjectionBySlug(prisma, slug);
  if (source === undefined) {
    return undefined;
  }
  const rows = publishedMaterialProjectionRowSchema.array().parse(
    await prisma.$queryRaw(
      projectionQuery({
        joins: Prisma.sql`
          left join materials.material_related_pins as related_pin
            on related_pin.source_material_id = ${source.materialId}::uuid
           and related_pin.target_material_id = publication.material_id
        `,
        where: Prisma.sql`
          where publication.material_id <> ${source.materialId}::uuid
            and (
              related_pin.target_material_id is not null
              or publication.topic_id = ${source.topic.id}::uuid
              or publication.format_id = ${source.format.id}::uuid
              or exists (
                select 1
                from materials.published_material_tags as candidate_tag
                join materials.published_material_tags as source_tag
                  on source_tag.tag_id = candidate_tag.tag_id
                where candidate_tag.material_id = publication.material_id
                  and source_tag.material_id = ${source.materialId}::uuid
              )
              or exists (
                select 1
                from materials.published_material_series_memberships as candidate_series
                join materials.published_material_series_memberships as source_series
                  on source_series.series_id = candidate_series.series_id
                where candidate_series.material_id = publication.material_id
                  and source_series.material_id = ${source.materialId}::uuid
              )
            )
        `,
        order: Prisma.sql`
          order by
            case when related_pin.ordinal is null then 1 else 0 end,
            related_pin.ordinal,
            (
              case when publication.topic_id = ${source.topic.id}::uuid then 8 else 0 end
              + case when publication.format_id = ${source.format.id}::uuid then 1 else 0 end
              + 2 * (
                select count(*)::integer
                from materials.published_material_tags as candidate_tag
                join materials.published_material_tags as source_tag
                  on source_tag.tag_id = candidate_tag.tag_id
                where candidate_tag.material_id = publication.material_id
                  and source_tag.material_id = ${source.materialId}::uuid
              )
              + 4 * (
                select count(*)::integer
                from materials.published_material_series_memberships as candidate_series
                join materials.published_material_series_memberships as source_series
                  on source_series.series_id = candidate_series.series_id
                where candidate_series.material_id = publication.material_id
                  and source_series.material_id = ${source.materialId}::uuid
              )
            ) desc,
            publication.published_at desc,
            publication.material_id desc
        `,
        limit: Prisma.sql`limit ${first + 1}`,
      }),
    ),
  );
  return {
    reference: {
      id: source.materialId,
      name: source.title,
      slug: source.slug,
    },
    items: rows.slice(0, first).map(toProjection),
    hasNext: rows.length > first,
  };
}

function projectionQuery({
  joins = Prisma.empty,
  limit,
  order = Prisma.sql`order by publication.published_at desc, publication.material_id desc`,
  where,
}: {
  readonly joins?: Prisma.Sql;
  readonly limit: Prisma.Sql;
  readonly order?: Prisma.Sql;
  readonly where: Prisma.Sql;
}): Prisma.Sql {
  return Prisma.sql`
    select
      publication.material_id,
      publication.content_version,
      publication.slug,
      publication.title,
      publication.summary,
      publication.access,
      publication.published_at,
      publication.primary_video_id,
      topic.id as topic_id,
      topic.name as topic_name,
      topic.slug as topic_slug,
      format.id as format_id,
      format.name as format_name,
      format.slug as format_slug,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object('id', tag.id, 'name', tag.name)
            order by tag.normalized_name
          )
          from materials.published_material_tags as membership
          join materials.tags as tag on tag.id = membership.tag_id
          where membership.material_id = publication.material_id
        ),
        '[]'::jsonb
      ) as tags,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', series.id,
              'name', series.name,
              'slug', series.slug,
              'ordinal', membership.ordinal
            )
            order by series.name, membership.ordinal
          )
          from materials.published_material_series_memberships as membership
          join materials.series on series.id = membership.series_id
          where membership.material_id = publication.material_id
        ),
        '[]'::jsonb
      ) as series_memberships
    from materials.published_materials as publication
    join materials.topics as topic on topic.id = publication.topic_id
    join materials.formats as format on format.id = publication.format_id
    ${joins}
    ${where}
    ${order}
    ${limit}
  `;
}

function toProjection(
  row: PublishedMaterialProjectionRow,
): PublishedMaterialProjectionDto {
  return {
    materialId: row.material_id,
    contentVersion: row.content_version,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    access: row.access,
    publishedAt: row.published_at.toISOString(),
    primaryVideoId: row.primary_video_id,
    topic: {
      id: row.topic_id,
      name: row.topic_name,
      slug: row.topic_slug,
    },
    format: {
      id: row.format_id,
      name: row.format_name,
      slug: row.format_slug,
    },
    tags: row.tags,
    seriesMemberships: row.series_memberships.map(
      ({ id, name, ordinal, slug }) => ({
        ordinal,
        series: { id, name, slug },
      }),
    ),
  };
}
