import type { ProductProgrammePlacement } from "./product-chapters.js";
import { createHash } from "node:crypto";

export interface ProductCompositionEntry {
  readonly materialId: string;
  readonly stepGroup: string | null;
  readonly chapterId: string | null;
}

export interface ProductChapterEntry {
  readonly supplementaryMaterialIds?: readonly string[] | undefined;
  readonly id: string;
  readonly name: string;
  readonly summary: string;
}

/** One optimistic token covers the whole composition: order, step sequences and chapters. */
export function productOrderVersion(
  entries: readonly ProductCompositionEntry[],
  chapters: readonly ProductChapterEntry[],
  programmePlacements?: readonly ProductProgrammePlacement[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...(programmePlacements === undefined ? {} : { programmePlacements }),
        chapters: chapters.map(
          ({ id, name, summary, supplementaryMaterialIds }) =>
            (supplementaryMaterialIds?.length ?? 0) > 0
              ? [id, name, summary, supplementaryMaterialIds]
              : [id, name, summary],
        ),
        entries: entries.map(({ materialId, stepGroup, chapterId }) => [
          materialId,
          stepGroup,
          chapterId,
        ]),
      }),
      "utf8",
    )
    .digest("hex");
}
