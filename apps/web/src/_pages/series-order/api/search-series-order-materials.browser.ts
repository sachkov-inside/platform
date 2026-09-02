import { z } from "zod";

import type { SeriesOrderMaterialSearchResult } from "@/features/series-order";

const materialSchema = z.looseObject({
  materialId: z.uuid(),
  publicationState: z.enum(["draft", "published", "unpublished"]),
  title: z.string().nullable(),
});

const responseSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    items: z.array(materialSchema),
    kind: z.literal("ready"),
    page: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
  z.looseObject({ kind: z.literal("signed_out") }),
  z.looseObject({ kind: z.literal("forbidden") }),
  z.looseObject({ kind: z.literal("unavailable") }),
  z.looseObject({ kind: z.literal("malformed_response") }),
  z.looseObject({ kind: z.literal("unexpected_error") }),
]);

export async function searchSeriesOrderMaterials({
  page,
  search,
  signal,
}: {
  readonly page: number;
  readonly search: string;
  readonly signal: AbortSignal;
}): Promise<SeriesOrderMaterialSearchResult> {
  const params = new URLSearchParams({ page: String(page), search });
  const response = await fetch(`/api/authoring/materials?${params.toString()}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal,
  }).catch(() => null);
  if (response === null || !response.ok) {
    return { kind: "error", reference: "series-material-search-request" };
  }
  const state = responseSchema.safeParse(await response.json());
  if (!state.success) {
    return { kind: "error", reference: "series-material-search-contract" };
  }
  if (state.data.kind === "signed_out" || state.data.kind === "forbidden") {
    return { kind: "unauthorized" };
  }
  if (state.data.kind !== "ready") {
    return {
      kind: "error",
      reference: `series-material-search-${state.data.kind}`,
    };
  }
  return {
    items: state.data.items.map((item) => ({
      materialId: item.materialId,
      publicationState: item.publicationState,
      title: item.title ?? "Без названия",
    })),
    kind: "ready",
    page: state.data.page,
    totalItems: state.data.totalItems,
    totalPages: state.data.totalPages,
  };
}
