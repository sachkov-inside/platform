import { createHash } from "node:crypto";

export interface ProductCompositionEntry {
  readonly materialId: string;
  readonly stepGroup: string | null;
  readonly chapterId: string | null;
}

export interface ProductChapterEntry {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
}

/** One optimistic token covers the whole composition: order, step sequences and chapters. */
export function productOrderVersion(
  entries: readonly ProductCompositionEntry[],
  chapters: readonly ProductChapterEntry[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        chapters: chapters.map(({ id, name, summary }) => [id, name, summary]),
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
