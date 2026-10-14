import "server-only";

import { PUBLISHED_CATALOG_CURSOR_MAX_LENGTH } from "@inside/contracts/published-catalog";

import { z } from "zod";

import {
  BackendConnectionError,
  requestPublicSiteIndex,
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

const siteIndexPageSchema = z.object({
  productSlugs: z.array(z.string().min(1)),
  topicSlugs: z.array(z.string().min(1)),
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
 * Карта сайта перечисляет только опубликованное, поэтому указатель запрашивается без подтверждения
 * доступа: гостевая выдача и есть публичный указатель.
 *
 * Руководства и темы приходят на первой странице указателя, который видит только те,
 * у которых есть хотя бы один опубликованный материал. Пустое руководство остаётся доступным по
 * своему адресу, но в карту сайта не попадает: пустые коллекции в контракте указателя не перечисляются.
 */
export async function getPublicSiteIndex(): Promise<PublicSiteIndex> {
  const materials: PublicSiteIndexMaterial[] = [];
  let productSlugs: readonly string[] = [];
  let topicSlugs: readonly string[] = [];
  let after: string | undefined;

  const continuations = new Set<string>();
  for (;;) {
    const siteIndexPage = await readSiteIndexPage(after);
    if (siteIndexPage === undefined) {
      return { kind: "unavailable" };
    }
    if (after === undefined) {
      productSlugs = siteIndexPage.productSlugs;
      topicSlugs = siteIndexPage.topicSlugs;
    }
    materials.push(...siteIndexPage.items);
    if (siteIndexPage.nextCursor === null) {
      break;
    }
    if (continuations.has(siteIndexPage.nextCursor)) {
      throw new BackendConnectionError(
        "invalid-response",
        "Content Library repeated a continuation",
      );
    }
    continuations.add(siteIndexPage.nextCursor);
    after = siteIndexPage.nextCursor;
  }

  return {
    productSlugs,
    kind: "ready",
    materials,
    topicSlugs,
  };
}

async function readSiteIndexPage(
  after: string | undefined,
): Promise<z.infer<typeof siteIndexPageSchema> | undefined> {
  let result: Awaited<ReturnType<typeof requestPublicSiteIndex>>;
  try {
    result = await requestPublicSiteIndex({
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

  const parsed = siteIndexPageSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Content Library response does not match the site index contract",
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
