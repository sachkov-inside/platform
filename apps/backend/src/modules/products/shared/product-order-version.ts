import type { ProductProgrammePlacement } from "./product-chapters.js";
import type { ProductTopicEntry } from "./product-topics.js";
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

/**
 * One optimistic token covers the whole composition: order, step sequences, chapters and Product
 * topics. A Product without topics keeps the token it had before topics existed.
 */
export function productOrderVersion(
  entries: readonly ProductCompositionEntry[],
  chapters: readonly ProductChapterEntry[],
  programmePlacements?: readonly ProductProgrammePlacement[],
  topics: readonly ProductTopicEntry[] = [],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...(programmePlacements === undefined ? {} : { programmePlacements }),
        ...(topics.length === 0
          ? {}
          : {
              topics: topics.map(({ id, name, summary, materialIds }) => [
                id,
                name,
                summary,
                materialIds,
              ]),
            }),
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
