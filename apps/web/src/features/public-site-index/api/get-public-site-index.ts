import "server-only";

import { PUBLISHED_CATALOG_CURSOR_MAX_LENGTH } from "@inside/contracts/published-catalog";

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
      readonly productSlugs: readonly string[];
      readonly kind: "ready";
      readonly materials: readonly PublicSiteIndexMaterial[];
      readonly topicSlugs: readonly string[];
    }
  | { readonly kind: "unavailable" };

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
  nextCursor: z
    .string()
    .min(1)
    .max(PUBLISHED_CATALOG_CURSOR_MAX_LENGTH)
    .nullable(),
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
  let productSlugs: readonly string[] = [];
  let topicSlugs: readonly string[] = [];
  let after: string | undefined;

  const continuations = new Set<string>();
  for (;;) {
    const catalogPage = await readCatalogPage(after);
    if (catalogPage === undefined) {
      return { kind: "unavailable" };
    }
    if (after === undefined) {
      productSlugs = catalogPage.facets.series.map(({ slug }) => slug);
      topicSlugs = catalogPage.facets.topics.map(({ slug }) => slug);
    }
    materials.push(...catalogPage.items);
    if (catalogPage.nextCursor === null) {
      break;
    }
    if (continuations.has(catalogPage.nextCursor)) {
      throw new BackendConnectionError(
        "invalid-response",
        "Content Library repeated a continuation",
      );
    }
    continuations.add(catalogPage.nextCursor);
    after = catalogPage.nextCursor;
  }

  return {
    productSlugs,
    kind: "ready",
    materials,
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
    if (
      error instanceof BackendConnectionError &&
      error.code === "unavailable"
    ) {
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
