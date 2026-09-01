export interface SeriesOrderItemPresentation {
  readonly materialId: string;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly title: string;
}

export interface SeriesOrderPresentation {
  readonly items: readonly SeriesOrderItemPresentation[];
  readonly name: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly orderVersion: string;
  readonly seriesId: string;
}

export interface ReorderSeriesInput {
  readonly expectedOrderVersion: string;
  readonly orderedMaterialIds: readonly string[];
  readonly seriesId: string;
}

export type ReorderSeriesResult = z.infer<typeof reorderSeriesResultSchema>;
import { z } from "zod";

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
