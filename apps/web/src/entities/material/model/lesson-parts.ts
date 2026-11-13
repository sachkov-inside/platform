import type { RenderedBlock } from "@inside/material-blocks";

/**
 * Where a part of a step-by-step lesson ends (#2122): a Lesson Step Break opens the next part by
 * its button, an exercise with `reveal: after-answer` by the first answer or «Пропустить». `at` is
 * the index of the top-level block; the gate belongs to the part it ends.
 */
export type LessonGate =
  | { readonly at: number; readonly kind: "break"; readonly label: string }
  | {
      readonly at: number;
      readonly kind: "exercise";
      readonly exerciseId: string;
    };

export interface LessonParts {
  readonly gates: readonly LessonGate[];
  /** Number of parts: one more than the gates. A lesson without gates is one part. */
  readonly count: number;
  /** The part, counted from 0, that holds the top-level block at `index`. */
  readonly partOf: (index: number) => number;
}

/** Parts have no id: they follow the order of the gates in the current version of the body. */
export function lessonParts(blocks: readonly RenderedBlock[]): LessonParts {
  const gates = blocks.flatMap((block, at): LessonGate[] => {
    if (block.kind === "step_break")
      return [{ at, kind: "break", label: block.label }];
    if (
      (block.kind === "quiz" ||
        block.kind === "match" ||
        block.kind === "order") &&
      block.reveal === "after-answer"
    )
      return [{ at, kind: "exercise", exerciseId: block.id }];
    return [];
  });
  return {
    gates,
    count: gates.length + 1,
    partOf: (index) => gates.filter((gate) => gate.at < index).length,
  };
}

/**
 * A saved count is ordinal, so a version with fewer or more gates changes what it opens by at most
 * the difference. The first part is always open.
 */
export function clampOpenedParts(
  saved: number | null | undefined,
  count: number,
): number {
  if (saved === null || saved === undefined || !Number.isFinite(saved))
    return 1;
  return Math.min(Math.max(Math.floor(saved), 1), Math.max(count, 1));
}
