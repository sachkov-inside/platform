import { Check, CircleHelp, X } from "lucide-react";
import type { ReactNode } from "react";
import type { ExerciseAnswerRecord } from "../../model/exercise-answers.client";

type ExerciseResult = ExerciseAnswerRecord["result"];

const resultLabels: Readonly<Record<ExerciseResult, string>> = {
  correct: "Правильно",
  incorrect: "Пока неверно",
  dontKnow: "Не знаю · без оценки",
};

const resultColors: Readonly<Record<ExerciseResult, string>> = {
  correct: "var(--callout-good)",
  incorrect: "var(--callout-bad)",
  dontKnow: "var(--foreground)",
};

/** Mark of a right or wrong item; the words beside it carry the meaning, not the colour. */
export function ResultIcon({ correct }: { readonly correct: boolean }) {
  return correct ? (
    <Check aria-hidden="true" className="size-4 shrink-0" />
  ) : (
    <X aria-hidden="true" className="size-4 shrink-0" />
  );
}

/** The verdict line of a checked exercise: «Правильно», «Пока неверно: 2 из 4», «Не знаю». */
export function ExerciseVerdict({
  result,
  score,
}: {
  readonly result: ExerciseResult;
  /** «2 из 4» after an incorrect answer that has right items. */
  readonly score?: string | undefined;
}) {
  return (
    <p
      className="flex items-center gap-2 text-sm font-semibold"
      data-exercise-verdict={result}
      style={{ color: resultColors[result] }}
    >
      {result === "dontKnow" ? (
        <CircleHelp aria-hidden="true" className="size-4 shrink-0" />
      ) : (
        <ResultIcon correct={result === "correct"} />
      )}
      {result === "incorrect" && score !== undefined
        ? `${resultLabels.incorrect}: ${score}`
        : resultLabels[result]}
    </p>
  );
}

/** What the author wrote for «Не знаю»: a hint and links back to the sections to reread. */
export function ExerciseDontKnowReview({
  dontKnow,
}: {
  readonly dontKnow: {
    readonly explanation: ReactNode;
    readonly reviewLinks: readonly string[];
  };
}) {
  return (
    <>
      <div className="mt-2">{dontKnow.explanation}</div>
      {dontKnow.reviewLinks.map((href, index) => (
        <a
          key={href}
          href={href}
          className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          Повторить раздел
          {dontKnow.reviewLinks.length > 1 ? ` ${String(index + 1)}` : ""}
        </a>
      ))}
    </>
  );
}
