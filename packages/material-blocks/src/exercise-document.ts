import { isExerciseKind } from "./exercise-rules.js";
import { materialBlockChildren } from "./extract.js";
import { materialHeadingAnchors } from "./heading-anchors.js";
import type { RenderedBlock, RenderedExercise } from "./rendered-block.js";

function isExercise(block: RenderedBlock): block is RenderedExercise {
  return isExerciseKind(block.kind);
}

/** Every exercise of a material in reading order, including any nested in a container. */
function materialExercises(
  blocks: readonly RenderedBlock[],
): readonly RenderedExercise[] {
  return blocks.flatMap((block) =>
    isExercise(block)
      ? [block]
      : materialExercises(materialBlockChildren(block)),
  );
}

/**
 * The first document-level exercise rule the material breaks: exercise ids are unique in the
 * material, and «Не знаю» review links address narrative headings, never hidden answers or
 * question text.
 */
export function materialExerciseReferenceIssue(
  blocks: readonly RenderedBlock[],
): string | undefined {
  const anchors = new Set(materialHeadingAnchors(blocks).values());
  const ids = new Set<string>();
  for (const exercise of materialExercises(blocks)) {
    if (ids.has(exercise.id)) return `Duplicate exercise ID ${exercise.id}`;
    ids.add(exercise.id);
    for (const href of exercise.dontKnow?.reviewLinks ?? []) {
      try {
        if (anchors.has(decodeURIComponent(href.slice(1)))) continue;
      } catch {
        // A malformed fragment cannot address a narrative heading.
      }
      return `${exercise.kind} ${exercise.id}: missing narrative anchor ${href}`;
    }
  }
  return undefined;
}

export function materialExerciseReferencesValid(
  blocks: readonly RenderedBlock[],
): boolean {
  return materialExerciseReferenceIssue(blocks) === undefined;
}

/** Position of an exercise in its lesson: «Упражнение N из M». */
export interface MaterialExerciseNumber {
  readonly number: number;
  readonly total: number;
}

/** Exercise id to its position among the material's exercises, in reading order. */
export function materialExerciseNumbers(
  blocks: readonly RenderedBlock[],
): ReadonlyMap<string, MaterialExerciseNumber> {
  const exercises = materialExercises(blocks);
  return new Map(
    exercises.map((exercise, index) => [
      exercise.id,
      { number: index + 1, total: exercises.length },
    ]),
  );
}
