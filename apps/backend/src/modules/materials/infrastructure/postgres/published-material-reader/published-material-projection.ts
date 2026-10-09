import type { HomeProjections } from "../../../features/read-home-projections/read-home-projections.contract.js";
import type { HomePinnedSeries } from "../../../features/read-home-pinned-series/read-home-pinned-series.js";
import {
  loadProductCompositions,
  productCompositionChapters,
  readProductCompositionAccess,
  MAX_PRODUCT_MATERIALS,
} from "../../../shared/product-composition.js";
import type {
  ContentAccess,
  Subject,
} from "../../../../content-access/index.js";
import { materialFormatsSql } from "../material-formats.js";
import {
  Prisma,
  type MaterialsPrisma,
} from "../../../../../infrastructure/prisma/index.js";
import { z } from "zod";

import { materialFormatSchema } from "../../../domain/material-format.js";
import { materialDifficultySchema } from "../../../domain/material-metadata.js";

import type { PublishedMaterialProjectionDto } from "../../../facets/published-material-reader/published-material.contract.js";
import type { ContentCoverProjection } from "../../../facets/content-covers/content-covers.js";
import type {
  ProductIntroductionDto,
  ProductLandingPageDto,
} from "../../../facets/material-authoring/content-collection.contract.js";
import { loadContentCoverProjections } from "../content-cover-projections.js";
import { readProductPage } from "../../../shared/product-page-reader.js";
import type {
  PublishedMaterialProjectionCursor,
  PublishedMaterialProjectionPageDto,
  PublishedMaterialProjectionSort,
} from "../../../features/list-published-material-projections/list-published-material-projections.contract.js";

interface PublishedMaterialProjectionSearchValues {
  readonly feedOnly: boolean;
  readonly after?: PublishedMaterialProjectionCursor;
  readonly canonicalTopicSlug?: string;
  readonly first: number;
  readonly formatSlugs: readonly string[];
  readonly q?: string;
  readonly seriesSlugs: readonly string[];
  readonly sort: PublishedMaterialProjectionSort;
  readonly topicSlugs: readonly string[];
}

export interface PublishedMaterialDiscoveryPage {
  /** Chapters of a Product's main path, in author order; empty for every other discovery kind. */
  readonly chapters: readonly {
    readonly id: string;
    readonly materialIds: readonly string[];
    readonly name: string;
    /** Авторское описание главы: на странице продукта оно объясняет, что внутри. */
    readonly summary: string;
  }[];
  readonly reference: {
    /**
     * Whether any lesson of this Product is written for both ways of going through it. The mode
     * switch belongs to the Product, so a Product without such a lesson shows none; false for every
     * other discovery kind.
     */
    readonly hasModeVariants: boolean;
    readonly id: string;
    /** Author-written Product introduction; null for every other discovery kind. */
    readonly introduction: ProductIntroductionDto | null;
    readonly name: string;
    /** Product page presentation and description; null for every other discovery kind. */
    readonly productPage: ProductLandingPageDto | null;
    readonly slug: string;
    readonly summary: string;
    readonly cover: ContentCoverProjection | null;
  };
  readonly relatedSeries: readonly {
    readonly id: string;
    readonly matchingMaterialCount: number;
    readonly name: string;
    readonly slug: string;
    readonly summary: string;
    readonly totalMaterialCount: number;
    readonly cover: ContentCoverProjection | null;
  }[];
  readonly topics: readonly {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly cover: ContentCoverProjection | null;
  }[];
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly hasNext: boolean;
}

const relatedSeriesRowSchema = z
  .object({
    id: z.uuid(),
    matching_material_count: z.coerce.number().int().nonnegative(),
    name: z.string(),
    slug: z.string(),
    summary: z.string(),
    total_material_count: z.coerce.number().int().nonnegative(),
    cover_id: z.uuid().nullable(),
  })
  .strict();

const discoveryTopicRowSchema = z
  .object({
    cover_id: z.uuid().nullable(),
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();

const coverProjectionSchema = z
  .object({
    coverId: z.uuid(),
    renditions: z.array(
      z
        .object({
          height: z.number().int().positive(),
          width: z.number().int().positive(),
        })
        .strict(),
    ),
  })
  .strict();

const publishedMaterialProjectionRowSchema = z.object({
  material_id: z.uuid(),
  content_version: z.coerce.number().int().positive(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  note_excerpt: z
    .object({
      text: z.string(),
      truncated: z.boolean(),
      linkUrl: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  difficulty: materialDifficultySchema.nullable(),
  outcomes: z.array(z.string()),
  access: z.enum(["free", "closed"]),
  published_at: z.date(),
  primary_video_id: z.uuid().nullable(),
  cover: coverProjectionSchema.nullable(),
  topic_id: z.uuid(),
  topic_name: z.string(),
  topic_slug: z.string(),
  format_id: materialFormatSchema,
  format_name: z.string(),
  format_slug: z.string(),
  tags: z.array(z.object({ id: z.uuid(), name: z.string() })),
  series_memberships: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      slug: z.string(),
      ordinal: z.number().int(),
      stepGroup: z.string().nullable(),
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
    summary: z.string().nullable(),
    cover: coverProjectionSchema.nullable(),
    previewMaterialIds: z.array(z.uuid()),
  })
  .strict();

const projectionMetadataRowSchema = z
  .object({
    formats: z.array(
      facetOptionSchema.extend({
        id: materialFormatSchema,
        slug: materialFormatSchema,
      }),
    ),
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
    selectProjectionMetadata(
      prisma,
      filters,
      values.canonicalTopicSlug === undefined ? values.q : undefined,
      values.canonicalTopicSlug === undefined,
      values.feedOnly,
    ),
  ]);
  const rows = searchedPublishedMaterialProjectionRowSchema
    .array()
    .parse(rawRows);
  const previewProjections = await selectPublishedMaterialProjectionsByIds(
    prisma,
    metadata.series.flatMap(({ previewMaterialIds }) => previewMaterialIds),
  );
  const previewById = new Map(
    previewProjections.map((projection) => [projection.materialId, projection]),
  );
  const visibleRows = rows.slice(0, values.first);
  const lastRow = visibleRows.at(-1);
  const hasNext = rows.length > values.first;
  return {
    continuation:
      hasNext && lastRow !== undefined
        ? toContinuation(lastRow, effectiveSort)
        : null,
    facets: {
      formats: metadata.formats.map((facet) =>
        projectFacet(facet, previewById),
      ),
      series: metadata.series.map((facet) => projectFacet(facet, previewById)),
      topics: metadata.topics.map((facet) => projectFacet(facet, previewById)),
    },
    items: visibleRows.map(toProjection),
    hasNext,
    totalCount: metadata.total_count,
  };
}

/** Home selects its visible groups before hydrating previews; catalog metadata stays independent. */
export async function selectHomeMaterialProjections(
  prisma: MaterialsPrisma,
  pin: HomePinnedSeries | null,
): Promise<HomeProjections> {
  const homeMetadataSchema = z
    .object({
      topics: z.array(facetOptionSchema),
      series: z.array(facetOptionSchema),
    })
    .strict();
  const feedQuery = (format: string) =>
    searchProjectionQuery(
      {
        // The catalog SQL includes one look-ahead row; seven plus that row is Home's eight.
        first: 7,
        feedOnly: true,
        formatSlugs: [format],
        seriesSlugs: [],
        topicSlugs: [],
        sort: "newest",
      },
      Prisma.sql`${projectionScopeSql(true)} and format.slug = ${format}`,
      Prisma.sql`0::double precision`,
    );
  const [rawMetadata, rawVideos, rawGuides, rawNotes] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      select
        coalesce((select jsonb_agg(jsonb_build_object(
          'id', topic.id, 'name', topic.name, 'slug', topic.slug, 'summary', topic.summary,
          'count', topic.count, 'cover', ${coverProjectionSql(Prisma.sql`topic.cover_id`)},
          'previewMaterialIds', '[]'::jsonb
        ) order by topic.name, topic.id) from (
          select topic.id, topic.name, topic.slug, topic.summary, topic.cover_id, count(*)::integer as count
          from materials.published_materials as publication
          join materials.topics as topic on topic.id = publication.topic_id
          where topic.archived_at is null
          group by topic.id, topic.name, topic.slug, topic.summary, topic.cover_id
          order by topic.name, topic.id
          limit 8
        ) as topic), '[]'::jsonb) as topics,
        coalesce((select jsonb_agg(jsonb_build_object(
          'id', series.id, 'name', series.name, 'slug', series.slug, 'summary', series.summary,
          'count', series.count, 'cover', ${coverProjectionSql(Prisma.sql`series.cover_id`)},
          'previewMaterialIds', array(
            select membership.material_id
            from materials.published_material_series_memberships as membership
            join materials.published_materials as publication on publication.material_id = membership.material_id
            where membership.series_id = series.id
            order by membership.ordinal, membership.material_id
            limit 3
          )
        ) order by series.name, series.id) from (
          select ranked.* from (
            select series.id, series.name, series.slug, series.summary, series.cover_id,
              count(*)::integer as count,
              row_number() over (order by series.name, series.id) as position
            from materials.published_material_series_memberships as membership
            join materials.published_materials as publication on publication.material_id = membership.material_id
            join materials.series as series on series.id = membership.series_id
            where series.archived_at is null
            group by series.id, series.name, series.slug, series.summary, series.cover_id
          ) as ranked
          where ranked.position <= 4 or ranked.id = ${pin?.id ?? null}::uuid
        ) as series), '[]'::jsonb) as series
    `),
    prisma.$queryRaw(feedQuery("video")),
    prisma.$queryRaw(feedQuery("guide")),
    prisma.$queryRaw(feedQuery("note")),
  ]);
  const metadata = homeMetadataSchema.array().parse(rawMetadata)[0];
  if (metadata === undefined)
    throw new TypeError("Home projection metadata is missing");
  const notes = await projectHomeFeedNotes(prisma, rawNotes);
  const previews = await selectPublishedMaterialProjectionsByIds(
    prisma,
    metadata.series.flatMap(({ previewMaterialIds }) => previewMaterialIds),
  );
  const previewById = new Map(previews.map((item) => [item.materialId, item]));
  const series = metadata.series.map((facet) =>
    projectFacet(facet, previewById),
  );
  const pinnedFacet = series.find((facet) => facet.id === pin?.id);
  return {
    topics: metadata.topics.map((facet) => projectFacet(facet, previewById)),
    playlists: series.slice(0, 4),
    pinnedSeries:
      pin === null || pinnedFacet === undefined
        ? null
        : { ...pinnedFacet, ...pin },
    videos: searchedPublishedMaterialProjectionRowSchema
      .array()
      .parse(rawVideos)
      .slice(0, 8)
      .map(toProjection),
    guides: searchedPublishedMaterialProjectionRowSchema
      .array()
      .parse(rawGuides)
      .slice(0, 8)
      .map(toProjection),
    notes,
  };
}

/** The legacy feed drops an excerpt when any active Product uses that note as a feed preview. */
async function projectHomeFeedNotes(
  prisma: MaterialsPrisma,
  rawNotes: unknown,
): Promise<readonly PublishedMaterialProjectionDto[]> {
  const notes = searchedPublishedMaterialProjectionRowSchema
    .array()
    .parse(rawNotes)
    .slice(0, 8);
  const excerptIds = notes
    .filter((note) => note.note_excerpt != null)
    .map((note) => note.material_id);
  if (excerptIds.length === 0) return notes.map(toProjection);
  // Inspect only the selected notes; do not hydrate or enrich invisible Product previews.
  const previewNotes = z
    .object({ material_id: z.uuid() })
    .strict()
    .array()
    .parse(
      await prisma.$queryRaw(Prisma.sql`
      select distinct membership.material_id
      from materials.published_material_series_memberships as membership
      join materials.series as series on series.id = membership.series_id
      where series.archived_at is null
        and membership.material_id in (${Prisma.join(excerptIds)})
        and (
          select count(*)
          from materials.published_material_series_memberships as earlier
          join materials.published_materials as publication on publication.material_id = earlier.material_id
          where earlier.series_id = membership.series_id
            and (earlier.ordinal, earlier.material_id) < (membership.ordinal, membership.material_id)
            and ${projectionScopeSql(true)}
        ) < 3
    `),
    );
  const previewIds = new Set(previewNotes.map((note) => note.material_id));
  return notes.map((note) =>
    toProjection(
      previewIds.has(note.material_id) ? { ...note, note_excerpt: null } : note,
    ),
  );
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
      (select jsonb_build_object(
         'text', left(document.plain_text, 1200),
         'truncated', char_length(document.plain_text) > 1200,
         'linkUrl', jsonb_path_query_first(material.body,
           '$.**.marks[*] ? (@.type == "link" && @.attrs.href like_regex "^https?://").attrs.href') #>> '{}')
       from materials.material_search_documents as document
       join materials.materials as material on material.id = document.material_id
         and material.content_version = document.content_version
       where publication.access = 'free' and publication.format_id = 'note'
         and document.material_id = publication.material_id
         and document.content_version = publication.content_version) as note_excerpt,
      publication.difficulty,
      publication.outcomes,
      publication.access,
      publication.published_at,
      publication.primary_video_id,
      ${coverProjectionSql()} as cover,
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
              'ordinal', membership.ordinal,
              'stepGroup', current_membership.step_group
            )
            order by series.name, membership.ordinal
          )
          from materials.published_material_series_memberships as membership
          left join materials.series_memberships as current_membership
            on current_membership.series_id = membership.series_id and current_membership.material_id = membership.material_id
          join materials.series as series on series.id = membership.series_id
          where membership.material_id = publication.material_id
        ),
        '[]'::jsonb
      ) as series_memberships
    from materials.published_materials as publication
    join materials.topics as topic on topic.id = publication.topic_id
    join (${materialFormatsSql}) as format(id, slug, name) on format.id = publication.format_id
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
  const conditions: Prisma.Sql[] = [projectionScopeSql(values.feedOnly)];
  if (values.q !== undefined) {
    conditions.push(
      Prisma.sql`publication.search_vector @@ ${textSearchQuerySql(values.q)}`,
    );
  }
  if (values.canonicalTopicSlug !== undefined) {
    conditions.push(Prisma.sql`topic.slug = ${values.canonicalTopicSlug}`);
  } else if (values.topicSlugs.length > 0) {
    conditions.push(
      Prisma.sql`topic.archived_at is null and topic.slug in (${Prisma.join(values.topicSlugs)})`,
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
          and selected_series.archived_at is null
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
  q: string | undefined,
  useIndependentFacets: boolean,
  feedOnly: boolean,
): Promise<z.infer<typeof projectionMetadataRowSchema>> {
  const filteredPublications = filteredPublicationsSql(filters);
  const independentPublications = useIndependentFacets
    ? filteredPublicationsSql(projectionScopeSql(feedOnly))
    : filteredPublications;
  const facetPublications = independentPublications;
  const seriesPublications = independentPublications;
  const rows = projectionMetadataRowSchema.array().parse(
    await prisma.$queryRaw(Prisma.sql`
      select
        (
          select count(*)::integer
          from (${filteredPublications}) as publication
        ) as total_count,
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'id', option.id,
                'name', option.name,
                'slug', option.slug,
                'summary', option.summary,
                'count', option.count,
                'cover', option.cover,
                'previewMaterialIds', '[]'::jsonb
              )
              order by option.name, option.id
            )
            from (
              select topic.id, topic.name, topic.slug, topic.summary,
                ${coverProjectionSql(Prisma.sql`topic.cover_id`)} as cover,
                count(*)::integer as count
              from (${facetPublications}) as publication
              join materials.topics as topic on topic.id = publication.topic_id
              where topic.archived_at is null
              group by topic.id, topic.name, topic.slug, topic.summary, topic.cover_id
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
                'summary', null,
                'count', option.count,
                'cover', null,
                'previewMaterialIds', '[]'::jsonb
              )
              order by option.name, option.id
            )
            from (
              select format.id, format.name, format.slug, count(*)::integer as count
              from (${facetPublications}) as publication
              join (${materialFormatsSql}) as format(id, slug, name) on format.id = publication.format_id
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
                'summary', option.summary,
                'count', option.count,
                'cover', option.cover,
                'previewMaterialIds', option.preview_material_ids
              )
              order by option.name, option.id
            )
            from (
              select series.id, series.name, series.slug, series.summary,
                ${coverProjectionSql(Prisma.sql`series.cover_id`)} as cover,
                array(
                  select preview_membership.material_id
                  from materials.published_material_series_memberships as preview_membership
                  join (${seriesPublications}) as preview_publication
                    on preview_publication.material_id = preview_membership.material_id
                  where preview_membership.series_id = series.id
                  order by preview_membership.ordinal, preview_membership.material_id
                  limit 3
                ) as preview_material_ids,
                count(*)::integer as count
              from materials.published_material_series_memberships as membership
              join materials.series as series on series.id = membership.series_id
              join (${seriesPublications}) as publication
                on publication.material_id = membership.material_id
              where series.archived_at is null
                ${seriesSearchSql(q)}
              group by series.id, series.name, series.slug, series.summary, series.cover_id
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

function seriesSearchSql(q: string | undefined): Prisma.Sql {
  return q === undefined
    ? Prisma.empty
    : Prisma.sql`
        and (
          to_tsvector(
            'russian'::regconfig,
            concat_ws(' ', series.name, series.summary)
          ) @@ websearch_to_tsquery('russian'::regconfig, ${q})
          or to_tsvector(
            'english'::regconfig,
            concat_ws(' ', series.name, series.summary)
          ) @@ websearch_to_tsquery('english'::regconfig, ${q})
          or to_tsvector(
            'simple'::regconfig,
            concat_ws(' ', series.name, series.summary)
          ) @@ websearch_to_tsquery('simple'::regconfig, ${q})
        )
      `;
}

function filteredPublicationsSql(filters: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    select publication.material_id, publication.topic_id, publication.format_id
    from materials.published_materials as publication
    join materials.topics as topic on topic.id = publication.topic_id
    join (${materialFormatsSql}) as format(id, slug, name) on format.id = publication.format_id
    where ${filters}
  `;
}

export async function selectPublishedMaterialProjectionsByIds(
  prisma: MaterialsPrisma,
  materialIds: readonly string[],
): Promise<readonly PublishedMaterialProjectionDto[]> {
  const uniqueIds = [...new Set(materialIds)];
  if (uniqueIds.length === 0) return [];
  const rows = publishedMaterialProjectionRowSchema.array().parse(
    await prisma.$queryRaw(
      projectionQuery({
        where: Prisma.sql`
          where publication.material_id in (${Prisma.join(uniqueIds)})

        `,
        limit: Prisma.empty,
      }),
    ),
  );
  return rows.map(toProjection);
}

function projectFacet(
  facet: z.infer<typeof facetOptionSchema>,
  previewById: ReadonlyMap<string, PublishedMaterialProjectionDto>,
) {
  return {
    count: facet.count,
    cover: facet.cover,
    id: facet.id,
    name: facet.name,
    previewItems: facet.previewMaterialIds.flatMap((materialId) => {
      const projection = previewById.get(materialId);
      return projection === undefined ? [] : [projection];
    }),
    slug: facet.slug,
    summary: facet.summary,
  };
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
     and selected_series.archived_at is null
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
  const [reference, rawRows, rawRelatedSeries] = await Promise.all([
    prisma.topic.findUnique({
      where: { slug },
      select: {
        coverId: true,
        id: true,
        name: true,
        slug: true,
        summary: true,
      },
    }),
    first === 0
      ? Promise.resolve([])
      : prisma.$queryRaw(
          projectionQuery({
            where: Prisma.sql`
              where topic.slug = ${slug}

            `,
            limit: Prisma.sql`limit ${first + 1}`,
          }),
        ),
    prisma.$queryRaw(Prisma.sql`
      select
        series.id,
        series.name,
        series.slug,
        series.summary,
        series.cover_id,
        count(*)::integer as matching_material_count,
        (
          select count(*)::integer
          from materials.published_material_series_memberships as total_membership
          join materials.published_materials as total_publication
            on total_publication.material_id = total_membership.material_id
          where total_membership.series_id = series.id

        ) as total_material_count
      from materials.published_material_series_memberships as membership
      join materials.published_materials as publication
        on publication.material_id = membership.material_id
      join materials.topics as topic on topic.id = publication.topic_id
      join materials.series as series on series.id = membership.series_id
      where topic.slug = ${slug}
        and series.archived_at is null

      group by series.id, series.name, series.slug, series.summary, series.cover_id
      order by series.name, series.id
    `),
  ]);
  if (reference === null) {
    return undefined;
  }
  const rows = publishedMaterialProjectionRowSchema.array().parse(rawRows);
  const relatedSeries = relatedSeriesRowSchema.array().parse(rawRelatedSeries);
  const covers = await loadContentCoverProjections(
    prisma,
    [
      reference.coverId,
      ...relatedSeries.map(({ cover_id }) => cover_id),
    ].flatMap((coverId) => (coverId === null ? [] : [coverId])),
  );
  return {
    chapters: [],
    reference: {
      id: reference.id,
      hasModeVariants: false,
      introduction: null,
      productPage: null,
      name: reference.name,
      slug: reference.slug,
      summary: reference.summary,
      cover:
        reference.coverId === null
          ? null
          : (covers.get(reference.coverId) ?? null),
    },
    relatedSeries: relatedSeries.map((series) => ({
      id: series.id,
      matchingMaterialCount: series.matching_material_count,
      name: series.name,
      slug: series.slug,
      summary: series.summary,
      totalMaterialCount: series.total_material_count,
      cover:
        series.cover_id === null ? null : (covers.get(series.cover_id) ?? null),
    })),
    topics: [],
    items: rows.slice(0, first).map(toProjection),
    hasNext: rows.length > first,
  };
}

export async function selectPublishedMaterialProjectionsBySeries(
  prisma: MaterialsPrisma,
  slug: string,
  first: number | null,
  reader?: {
    readonly subject: Subject;
    readonly contentAccess: Pick<ContentAccess, "checkProductAccess">;
  },
): Promise<PublishedMaterialDiscoveryPage | undefined | "unavailable"> {
  const [reference] = await loadProductCompositions(
    prisma,
    { slugs: [slug] },
    1,
  );
  if (reference === undefined) return undefined;
  const access = await readProductCompositionAccess(reference, reader);
  if (access === "unavailable") return "unavailable";
  if (access === "closed") return undefined;
  if (reference.placements.length > MAX_PRODUCT_MATERIALS)
    throw new RangeError("Product composition exceeds its bound");
  const selected =
    first === null
      ? reference.materials
      : reference.materials.slice(0, first + 1);
  const projections = await selectPublishedMaterialProjectionsByIds(
    prisma,
    selected.map((item) => item.materialId),
  );
  const byId = new Map(projections.map((item) => [item.materialId, item]));
  const rows = selected.flatMap((item) => {
    const projection = byId.get(item.materialId);
    return projection === undefined ? [] : [projection];
  });
  const topics = discoveryTopicRowSchema.array().parse(
    await prisma.topic
      .findMany({
        where: {
          id: {
            in: [
              ...new Set(
                reference.materials.flatMap((item) =>
                  item.topicId === null ? [] : [item.topicId],
                ),
              ),
            ],
          },
          archivedAt: null,
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, slug: true, coverId: true },
      })
      .then((topics) =>
        topics.map(({ coverId, ...topic }) => ({
          ...topic,
          cover_id: coverId,
        })),
      ),
  );
  const covers = await loadContentCoverProjections(
    prisma,
    [reference.coverId, ...topics.map(({ cover_id }) => cover_id)].flatMap(
      (coverId) => (coverId === null ? [] : [coverId]),
    ),
  );
  return {
    chapters: productCompositionChapters(reference).map(
      ({ id, materialIds, name, summary }) => ({
        id,
        materialIds,
        name,
        summary,
      }),
    ),
    reference: {
      id: reference.id,
      hasModeVariants: reference.materials.some((item) => item.hasModeVariants),
      introduction: {
        audience: reference.audience,
        outcome: reference.outcome,
        prerequisites: reference.prerequisites,
        scope: reference.scope,
      },
      name: reference.name,
      productPage: {
        presentation: reference.presentation,
        page: readProductPage(reference.page, `Product ${reference.slug}`),
      },
      slug: reference.slug,
      summary: reference.summary,
      cover:
        reference.coverId === null
          ? null
          : (covers.get(reference.coverId) ?? null),
    },
    relatedSeries: [],
    topics: topics.map(({ cover_id, ...topic }) => ({
      ...topic,
      cover: cover_id === null ? null : (covers.get(cover_id) ?? null),
    })),
    items: first === null ? rows : rows.slice(0, first),
    hasNext: first !== null && rows.length > first,
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
              or publication.format_id = ${source.format.id}
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
              + case when publication.format_id = ${source.format.id} then 1 else 0 end
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
    chapters: [],
    reference: {
      id: source.materialId,
      hasModeVariants: false,
      introduction: null,
      productPage: null,
      name: source.title,
      slug: source.slug,
      summary: source.summary,
      cover: source.cover,
    },
    relatedSeries: [],
    topics: [],
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
      publication.difficulty,
      publication.outcomes,
      publication.access,
      publication.published_at,
      publication.primary_video_id,
      ${coverProjectionSql()} as cover,
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
              'ordinal', membership.ordinal,
              'stepGroup', current_membership.step_group
            )
            order by series.name, membership.ordinal
          )
          from materials.published_material_series_memberships as membership
          left join materials.series_memberships as current_membership
            on current_membership.series_id = membership.series_id and current_membership.material_id = membership.material_id
          join materials.series on series.id = membership.series_id
          where membership.material_id = publication.material_id
        ),
        '[]'::jsonb
      ) as series_memberships
    from materials.published_materials as publication
    join materials.topics as topic on topic.id = publication.topic_id
    join (${materialFormatsSql}) as format(id, slug, name) on format.id = publication.format_id
    ${joins}
    ${where}
    ${order}
    ${limit}
  `;
}

function coverProjectionSql(
  coverId: Prisma.Sql = Prisma.sql`publication.cover_id`,
): Prisma.Sql {
  return Prisma.sql`
    (
      select jsonb_build_object(
        'coverId', cover.id,
        'renditions', coalesce(
          (
            select jsonb_agg(
              jsonb_build_object('width', rendition.width, 'height', rendition.height)
              order by rendition.width
            )
            from materials.content_cover_renditions as rendition
            where rendition.cover_id = cover.id
          ),
          '[]'::jsonb
        )
      )
      from materials.content_covers as cover
      where cover.id = ${coverId}
        and cover.state = 'ready'
        and cover.currently_referenced
    )
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
    ...(row.note_excerpt == null
      ? {}
      : { noteExcerpt: projectNoteExcerpt(row.note_excerpt) }),
    difficulty: row.difficulty,
    outcomes: row.outcomes,
    access: row.access,
    publishedAt: row.published_at.toISOString(),
    primaryVideoId: row.primary_video_id,
    cover: row.cover,
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
      ({ id, name, ordinal, slug, stepGroup }) => ({
        ordinal,
        stepGroup,
        series: { id, name, slug },
      }),
    ),
  };
}

/** A public note may expose one link, never its private or stale body. */
function projectNoteExcerpt(excerpt: {
  readonly text: string;
  readonly truncated: boolean;
  readonly linkUrl?: string | null | undefined;
}): NonNullable<PublishedMaterialProjectionDto["noteExcerpt"]> {
  let linkUrl: string | undefined;
  if (excerpt.linkUrl != null && excerpt.linkUrl.length <= 2048) {
    // Invalid links do not invalidate the rest of a published note.
    const url = URL.parse(excerpt.linkUrl);
    if (
      url !== null &&
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.href.length <= 2048
    )
      linkUrl = url.href;
  }
  return {
    text: excerpt.text,
    truncated: excerpt.truncated,
    ...(linkUrl === undefined ? {} : { linkUrl }),
  };
}

function projectionScopeSql(feedOnly: boolean): Prisma.Sql {
  return feedOnly
    ? Prisma.sql`publication.access = 'free' and exists (
        select 1 from materials.materials as original
        where original.id = publication.material_id and original.show_in_feed
      )`
    : Prisma.sql`true`;
}
