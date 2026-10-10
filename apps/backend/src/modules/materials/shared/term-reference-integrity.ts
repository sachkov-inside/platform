import { referencedTermIds, type RenderedBlock } from "@inside/material-blocks";
import type { MaterialsPrisma } from "../../../infrastructure/prisma/index.js";
import type { ValidationIssue } from "../domain/material-body/material-body.js";

/** Server validation applies to imports and editor saves, including typed references held in quizzes. */
export async function inspectTermReferences(
  prisma: MaterialsPrisma,
  blocks: readonly RenderedBlock[],
  requirePublished: boolean,
): Promise<readonly ValidationIssue[]> {
  const ids = referencedTermIds(blocks);
  if (ids.length === 0) return [];
  const rows = await prisma.termDefinition.findMany({
    where: { termId: { in: [...ids] } },
    select: { termId: true, publicationState: true },
  });
  const states = new Map(rows.map((row) => [row.termId, row.publicationState]));
  return ids.flatMap((id) => {
    const state = states.get(id);
    const code =
      state === undefined
        ? "term_not_found"
        : requirePublished && state !== "published"
          ? "term_unpublished"
          : undefined;
    return code === undefined ? [] : [{ code, path: `/body/terms/${id}` }];
  });
}
