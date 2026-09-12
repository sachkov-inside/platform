import "server-only";

import { z } from "zod";

import {
  contentCoverSchema,
  publishedMaterialProjectionSchema,
  toMaterialPreview,
} from "@/entities/material.model";
import {
  BackendConnectionError,
  requestHomeContent,
} from "@/shared/api/backend/index.server";
import { dependencyUnavailableProblemSchema } from "@/shared/api/problem-details";
import type { HomeResult } from "../model/home-view";

const homeCollectionSchema = z
  .object({
    count: z.number().int().nonnegative(),
    cover: contentCoverSchema.nullable(),
    id: z.uuid(),
    name: z.string(),
    previewItems: z.array(publishedMaterialProjectionSchema),
    slug: z.string(),
    summary: z.string().nullable(),
  })
  .strict();

const homeSchema = z
  .object({
    pinnedSeries: homeCollectionSchema.nullable(),
    guides: z.array(publishedMaterialProjectionSchema),
    notes: z.array(publishedMaterialProjectionSchema),
    membership: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("active") }).strict(),
      // Адрес покупки главной больше не нужен: она ведёт на внутреннюю витрину. Контракт его ещё
      // обещает, поэтому ключ принимается, но его вид ничего не решает и не ломает главную.
      z.object({ acquisitionUrl: z.string(), kind: z.literal("inactive") }).strict(),
      z.object({ kind: z.literal("notOffered") }).strict(),
      z.object({ kind: z.literal("unknown") }).strict(),
    ]),
    playlists: z.array(homeCollectionSchema),
    topics: z.array(homeCollectionSchema),
    videos: z.array(publishedMaterialProjectionSchema),
  })
  .strict();

export async function getHome(
  accessToken?: string,
): Promise<HomeResult> {
  let result: Awaited<ReturnType<typeof requestHomeContent>>;
  try {
    result = await requestHomeContent(
      accessToken === undefined ? {} : { accessToken },
    );
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unavailable" };
    }
    throw error;
  }
  if (!result.ok) {
    if (dependencyUnavailableProblemSchema.safeParse(result.problem).success) {
      return { kind: "unavailable" };
    }
    throw new BackendConnectionError(
      "backend-error",
      `Home request returned ${String(result.response.status)}`,
    );
  }
  const parsed = homeSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Home response does not match the contract",
      { cause: parsed.error },
    );
  }
  return {
    kind: "ready",
    value: {
      // Внешний адрес покупки на главную не попадает: контракт его ещё обещает, но призыв ведёт
      // внутрь платформы, и презентационная модель знает только состояние подписки.
      membership: { kind: parsed.data.membership.kind },
      pinnedSeries: parsed.data.pinnedSeries === null ? null : mapCollection(parsed.data.pinnedSeries),
      guides: parsed.data.guides.map(toMaterialPreview),
      notes: parsed.data.notes.map(toMaterialPreview),
      playlists: parsed.data.playlists.map(mapCollection),
      topics: parsed.data.topics.map(mapCollection),
      videos: parsed.data.videos.map(toMaterialPreview),
    },
  };
}

function mapCollection(collection: z.infer<typeof homeCollectionSchema>) {
  return {
    ...collection,
    previewItems: collection.previewItems.map(toMaterialPreview),
  };
}
