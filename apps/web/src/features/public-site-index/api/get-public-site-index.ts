import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestPublishedMaterialCatalog,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";

/** Опубликованный материал в карте сайта: адрес и дата публикации. */
export interface PublicSiteIndexMaterial {
  readonly publishedAt: string;
  readonly slug: string;
}

export type PublicSiteIndex =
  | {
      readonly guideSlugs: readonly string[];
      readonly kind: "ready";
      readonly materials: readonly PublicSiteIndexMaterial[];
      readonly topicSlugs: readonly string[];
    }
  | { readonly kind: "unavailable" };

/** Сто страниц каталога: испорченный курсор не должен превратиться в бесконечный обход. */
const MAX_CATALOG_PAGES = 100;

/** Предел формата карты сайта. Сторожит случай, когда страница каталога станет крупнее. */
const MAX_MATERIALS = 50_000;

const collectionFacetSchema = z.object({ slug: z.string().min(1) });
const catalogPageSchema = z.object({
  facets: z.object({
    series: z.array(collectionFacetSchema),
    topics: z.array(collectionFacetSchema),
  }),
  items: z.array(
    z.object({
      publishedAt: z.iso.datetime({ offset: true }),
      slug: z.string().min(1),
    }),
  ),
  nextCursor: z.string().min(1).max(512).nullable(),
});

/**
 * Карта сайта перечисляет только опубликованное, поэтому каталог запрашивается без подтверждения
 * доступа: гостевая выдача и есть публичный указатель.
 *
 * Руководства и темы приходят фасетами каталога материалов, то есть указатель видит только те,
 * у которых есть хотя бы один опубликованный материал. Пустое руководство остаётся доступным по
 * своему адресу, но в карту сайта не попадает: отдельного перечисления коллекций в контракте нет.
 */
export async function getPublicSiteIndex(): Promise<PublicSiteIndex> {
  const materials: PublicSiteIndexMaterial[] = [];
  let guideSlugs: readonly string[] = [];
  let topicSlugs: readonly string[] = [];
  let after: string | undefined;

  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const catalogPage = await readCatalogPage(after);
    if (catalogPage === undefined) {
      return { kind: "unavailable" };
    }
    if (page === 0) {
      guideSlugs = catalogPage.facets.series.map(({ slug }) => slug);
      topicSlugs = catalogPage.facets.topics.map(({ slug }) => slug);
    }
    materials.push(...catalogPage.items);
    if (catalogPage.nextCursor === null || materials.length >= MAX_MATERIALS) {
      break;
    }
    after = catalogPage.nextCursor;
  }

  return {
    guideSlugs,
    kind: "ready",
    materials: materials.slice(0, MAX_MATERIALS),
    topicSlugs,
  };
}

async function readCatalogPage(
  after: string | undefined,
): Promise<z.infer<typeof catalogPageSchema> | undefined> {
  let result: Awaited<ReturnType<typeof requestPublishedMaterialCatalog>>;
  try {
    result = await requestPublishedMaterialCatalog({
      sort: "newest",
      ...(after === undefined ? {} : { after }),
    });
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return undefined;
    }
    throw error;
  }

  if (!result.ok) {
    if (dependencyUnavailableProblemSchema.safeParse(result.problem).success) {
      return undefined;
    }
    throw new BackendConnectionError(
      "backend-error",
      `Content Library request returned ${String(result.response.status)}`,
    );
  }

  const parsed = catalogPageSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Content Library response does not match the site index contract",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
