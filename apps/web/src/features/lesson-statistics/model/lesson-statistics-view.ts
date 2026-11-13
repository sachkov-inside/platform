import {
  exerciseFingerprint,
  isExerciseKind,
  materialBlockText,
  renderedBlockSchema,
  type ExerciseAnswer,
  type RenderedBlock,
  type RenderedExercise,
} from "@inside/material-blocks";

import type { ExerciseStatistics } from "./lesson-statistics-contract";

export interface ExerciseVersionView {
  readonly fingerprint: string;
  /** The version matches the exercise in the edited document. */
  readonly current: boolean;
  readonly firstAnsweredAt: string;
  readonly respondents: number;
  readonly firstTryCorrectPercent: number;
  readonly firstTryDontKnow: number;
  readonly mostFrequentWrong: {
    readonly text: string;
    readonly count: number;
  } | null;
}

export interface ExerciseStatisticsView {
  readonly exerciseId: string;
  /** «Упражнение N» as the lesson numbers it, or «Убрано из урока». */
  readonly title: string;
  /** The question text; an exercise gone from the lesson shows its id. */
  readonly question: string;
  /** The current version first, then older ones from the newest. */
  readonly versions: readonly ExerciseVersionView[];
}

interface DocumentNode {
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly content?: readonly DocumentNode[];
}

/** Exercises of an edited document in reading order; a malformed exercise node is skipped. */
export function documentExercises(document: unknown): RenderedExercise[] {
  const found: RenderedExercise[] = [];
  const visit = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    const { attrs, content } = node as DocumentNode;
    const parsed = renderedBlockSchema.safeParse(attrs?.["exercise"]);
    if (parsed.success && isRenderedExercise(parsed.data))
      found.push(parsed.data);
    if (Array.isArray(content)) for (const child of content) visit(child);
  };
  visit(document);
  return found;
}

function isRenderedExercise(block: RenderedBlock): block is RenderedExercise {
  return isExerciseKind(block.kind);
}

/**
 * Statistics placed in the lesson: exercises of the document in its order (one nobody answered
 * yet has no versions), then exercises the lesson no longer holds. Item ids of a wrong answer
 * read as their text in the current exercise; an item the lesson no longer has keeps its id.
 */
export function lessonStatisticsView(
  exercises: readonly RenderedExercise[],
  statistics: readonly ExerciseStatistics[],
): ExerciseStatisticsView[] {
  const byId = new Map(statistics.map((entry) => [entry.exerciseId, entry]));
  const inLesson = new Set(exercises.map((exercise) => exercise.id));
  return [
    ...exercises.map((exercise, index) => ({
      exerciseId: exercise.id,
      title: `Упражнение ${String(index + 1)}`,
      question: richText(exercise.question),
      versions: versionViews(byId.get(exercise.id)?.versions ?? [], exercise),
    })),
    ...statistics
      .filter((entry) => !inLesson.has(entry.exerciseId))
      .map((entry) => ({
        exerciseId: entry.exerciseId,
        title: "Убрано из урока",
        question: entry.exerciseId,
        versions: versionViews(entry.versions, undefined),
      })),
  ];
}

function versionViews(
  versions: ExerciseStatistics["versions"],
  exercise: RenderedExercise | undefined,
): ExerciseVersionView[] {
  const currentFingerprint =
    exercise === undefined ? undefined : exerciseFingerprint(exercise);
  const labels =
    exercise === undefined ? new Map<string, string>() : itemLabels(exercise);
  return versions
    .map((version) => ({
      fingerprint: version.fingerprint,
      current: version.fingerprint === currentFingerprint,
      firstAnsweredAt: version.firstAnsweredAt,
      respondents: version.respondents,
      firstTryCorrectPercent: Math.round(
        (version.firstTryCorrect / version.respondents) * 100,
      ),
      firstTryDontKnow: version.firstTryDontKnow,
      mostFrequentWrong:
        version.mostFrequentWrongAnswer === null
          ? null
          : {
              text: answerText(
                version.mostFrequentWrongAnswer.answer,
                (id) => labels.get(id) ?? id,
              ),
              count: version.mostFrequentWrongAnswer.count,
            },
    }))
    .sort((left, right) =>
      left.current !== right.current
        ? left.current
          ? -1
          : 1
        : right.firstAnsweredAt.localeCompare(left.firstAnsweredAt),
    );
}

function itemLabels(exercise: RenderedExercise): Map<string, string> {
  switch (exercise.kind) {
    case "quiz":
      return new Map(
        exercise.options.map((option) => [option.id, richText(option.content)]),
      );
    case "match":
      return new Map([
        ...exercise.rows.map((row) => [row.id, richText(row.content)] as const),
        ...exercise.choices.map(
          (choice) => [choice.id, richText(choice.content)] as const,
        ),
      ]);
    case "order":
      return new Map(
        exercise.steps.map((step) => [step.id, richText(step.content)]),
      );
  }
}

/** The whole wrong answer: chosen options, every row with its choice, or the full order. */
function answerText(
  answer: ExerciseAnswer,
  label: (id: string) => string,
): string {
  switch (answer.kind) {
    case "options":
      return answer.optionIds.map(label).join("; ");
    case "matches":
      return answer.matches
        .map((match) => `${label(match.rowId)} → ${label(match.choiceId)}`)
        .join("; ");
    case "sequence":
      return answer.stepIds.map(label).join(" → ");
    case "dontKnow":
      return "Не знаю";
  }
}

function richText(blocks: readonly RenderedBlock[]): string {
  return blocks.map(materialBlockText).join(" ").replace(/\s+/gu, " ").trim();
}
