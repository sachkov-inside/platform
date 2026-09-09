import { createHash } from "node:crypto";

export interface GuideCompositionEntry {
  readonly materialId: string;
  readonly stepGroup: string | null;
  readonly chapterId: string | null;
}

export interface GuideChapterEntry {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
}

/** One optimistic token covers the whole composition: order, step sequences and chapters. */
export function guideOrderVersion(
  entries: readonly GuideCompositionEntry[],
  chapters: readonly GuideChapterEntry[],
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
