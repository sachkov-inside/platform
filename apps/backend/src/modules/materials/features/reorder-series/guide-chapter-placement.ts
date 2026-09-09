import type { ValidationIssue } from "../../domain/material-body/material-body.js";

/**
 * A Guide Chapter is a continuous named part of the main path. Its Materials therefore occupy one
 * uninterrupted run, and chapters that hold Materials follow the declared chapter order. Materials
 * outside every chapter stay allowed, so a flat Guide and a partly grouped Guide remain valid.
 */
export function guideChapterPlacementIssues(
  orderedMaterialIds: readonly string[],
  chapterAssignments: Readonly<Record<string, string>>,
  chapterIds: readonly string[],
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const finished = new Set<string>();
  const started: string[] = [];
  let previous: string | null = null;
  for (const [index, materialId] of orderedMaterialIds.entries()) {
    const chapterId = chapterAssignments[materialId] ?? null;
    if (chapterId !== previous) {
      if (previous !== null) {
        finished.add(previous);
      }
      if (chapterId !== null && finished.has(chapterId)) {
        issues.push({
          code: "guide_chapter_not_continuous",
          path: `/orderedMaterialIds/${String(index)}`,
        });
      } else if (chapterId !== null) {
        started.push(chapterId);
      }
    }
    previous = chapterId;
  }
  const expected = chapterIds.filter((id) => started.includes(id));
  const outOfOrder = started.find((id, index) => expected[index] !== id);
  if (outOfOrder !== undefined) {
    issues.push({
      code: "guide_chapter_out_of_order",
      path: `/chapters/${String(chapterIds.indexOf(outOfOrder))}`,
    });
  }
  return issues;
}
