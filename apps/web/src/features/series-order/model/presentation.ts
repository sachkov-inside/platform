import type { UseQueryOptions } from "@tanstack/react-query";
import { z } from "zod";

export interface GuideChapterPresentation {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
}

/** One Web-side owner for the chapter limits the Nest contract enforces. */
export const GUIDE_CHAPTER_NAME_MAX = 120;
export const GUIDE_CHAPTER_SUMMARY_MAX = 4000;
export const guideChapterDraftSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(GUIDE_CHAPTER_NAME_MAX),
    summary: z.string().trim().max(GUIDE_CHAPTER_SUMMARY_MAX),
  })
  .strict();

export interface SeriesOrderItemPresentation {
  readonly chapterId?: string | null;
  readonly materialId: string;
  readonly stepGroup?: string | null;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly title: string;
}

export interface SeriesOrderPresentation {
  readonly archived: boolean;
  readonly chapters: readonly GuideChapterPresentation[];
  readonly items: readonly SeriesOrderItemPresentation[];
  readonly name: string;
  readonly options: readonly { readonly archived?: boolean; readonly label: string; readonly value: string }[];
  readonly orderVersion: string;
  readonly seriesId: string;
}

export interface SeriesOrderMaterialPage {
  readonly items: readonly SeriesOrderItemPresentation[];
  readonly kind: "ready";
  readonly page: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

export type SeriesOrderMaterialSearchResult =
  | SeriesOrderMaterialPage
  | { readonly kind: "unauthorized" }
  | { readonly kind: "error"; readonly reference: string };

export type SeriesOrderMaterialSearchQueryKey = readonly [
  "series-order",
  "material-search",
  string,
  number,
];

export type CreateSeriesOrderMaterialSearchQueryOptions = (input: {
  readonly page: number;
  readonly search: string;
}) => UseQueryOptions<
  SeriesOrderMaterialSearchResult,
  Error,
  SeriesOrderMaterialSearchResult,
  SeriesOrderMaterialSearchQueryKey
>;

export interface ReorderSeriesInput {
  readonly chapters?: readonly GuideChapterPresentation[];
  readonly chapterAssignments?: Readonly<Record<string, string>>;
  readonly expectedOrderVersion: string;
  readonly orderedMaterialIds: readonly string[];
  readonly stepGroups?: Readonly<Record<string, string>>;
  readonly seriesId: string;
}

export type ReorderSeriesResult = z.infer<typeof reorderSeriesResultSchema>;

export const reorderSeriesResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("saved"),
      orderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict(),
  z.object({ kind: z.literal("conflict") }).strict(),
  z.object({ kind: z.literal("unauthorized") }).strict(),
  z.object({ kind: z.literal("error"), reference: z.string() }).strict(),
]);
