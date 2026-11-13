import type { ReactNode } from "react";
import { MaterialExerciseFrame } from "./material-exercise-frame";

interface Item {
  readonly id: string;
  readonly content: ReactNode;
}

/**
 * «Сопоставь» without its interaction yet (#2123): the rows and the choices to match them with.
 * Answers and explanations stay out of the page until the reader can answer.
 */
export function MaterialMatch({
  id,
  heading,
  context,
  question,
  rows,
  choices,
}: {
  readonly id: string;
  readonly heading: string;
  readonly context?: ReactNode;
  readonly question: ReactNode;
  readonly rows: readonly Item[];
  readonly choices: readonly Item[];
}) {
  return (
    <MaterialExerciseFrame
      exerciseId={id}
      kind="match"
      heading={heading}
      context={context}
      question={question}
    >
      <ol className="mt-4 space-y-2" data-exercise-rows>
        {rows.map((row) => (
          <li
            key={row.id}
            className="min-w-0 rounded-lg border border-border bg-card px-2.5 py-2 sm:px-3"
          >
            {row.content}
          </li>
        ))}
      </ol>
      <ul className="mt-3 flex flex-wrap gap-2" data-exercise-choices>
        {choices.map((choice) => (
          <li
            key={choice.id}
            className="min-w-0 rounded-lg bg-secondary px-2.5 py-1.5 text-secondary-foreground"
          >
            {choice.content}
          </li>
        ))}
      </ul>
    </MaterialExerciseFrame>
  );
}

/** Steps in an order that depends only on the exercise id: never the stored correct order. */
export function shuffledSteps<Step extends { readonly id: string }>(
  exerciseId: string,
  steps: readonly Step[],
): readonly Step[] {
  // Exercise ids are lowercase latin, so UTF-16 code units are its characters.
  let seed = 7;
  for (let index = 0; index < exerciseId.length; index++)
    seed = (seed * 31 + exerciseId.charCodeAt(index)) >>> 0;
  const next = () => {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
    return seed;
  };
  const result = [...steps];
  for (let index = result.length - 1; index > 0; index--) {
    const other = next() % (index + 1);
    const current = result[index];
    const swapped = result[other];
    if (current === undefined || swapped === undefined) continue;
    result[index] = swapped;
    result[other] = current;
  }
  // A shuffle that lands on the key would show the answer: rotate it by one step instead.
  return result.every((step, index) => step.id === steps[index]?.id)
    ? [...result.slice(1), ...result.slice(0, 1)]
    : result;
}

/**
 * «Расставь по порядку» without its interaction yet (#2123): the steps, shuffled. The package
 * order is the key, so the page never shows it.
 */
export function MaterialOrder({
  id,
  heading,
  context,
  question,
  steps,
}: {
  readonly id: string;
  readonly heading: string;
  readonly context?: ReactNode;
  readonly question: ReactNode;
  readonly steps: readonly Item[];
}) {
  return (
    <MaterialExerciseFrame
      exerciseId={id}
      kind="order"
      heading={heading}
      context={context}
      question={question}
    >
      <ul className="mt-4 space-y-2" data-exercise-steps>
        {shuffledSteps(id, steps).map((step) => (
          <li
            key={step.id}
            className="min-w-0 rounded-lg border border-border bg-card px-2.5 py-2 sm:px-3"
          >
            {step.content}
          </li>
        ))}
      </ul>
    </MaterialExerciseFrame>
  );
}
