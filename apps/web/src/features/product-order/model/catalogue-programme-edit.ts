import type { ProductOrderPresentation } from "./presentation";

type Placement = NonNullable<
  ProductOrderPresentation["programmePlacements"]
>[number];

/** Catalogue controls can move existing primary slots, without enrolling catalogue-only Materials. */
export function editCatalogueProgramme(
  current: readonly Placement[],
  entries: readonly {
    readonly materialId: string;
    readonly chapterId: string | null;
    readonly stepGroup: string | null;
  }[],
  chapterIds: readonly string[],
): readonly Placement[] {
  const retained = new Set(entries.map((entry) => entry.materialId));
  const primary = new Map<string, Placement>();
  for (const entry of current) {
    if (!primary.has(entry.materialId)) primary.set(entry.materialId, entry);
  }
  const desired = entries.flatMap((entry) => {
    const previous = primary.get(entry.materialId);
    return previous === undefined ? [] : [{ ...previous, ...entry }];
  });
  const chapters: readonly (string | null)[] = [...chapterIds, null];
  return chapters.flatMap((chapterId) => {
    const replacements = desired.filter(
      (entry) => entry.chapterId === chapterId,
    );
    let index = 0;
    const kept = current.flatMap((entry) => {
      const normalizedChapter = chapterIds.includes(entry.chapterId ?? "")
        ? entry.chapterId
        : null;
      if (normalizedChapter !== chapterId || !retained.has(entry.materialId))
        return [];
      if (entry.id === primary.get(entry.materialId)?.id) {
        const replacement = replacements[index++];
        return replacement === undefined ? [] : [replacement];
      }
      return [{ ...entry, chapterId: normalizedChapter }];
    });
    return [...kept, ...replacements.slice(index)];
  });
}
