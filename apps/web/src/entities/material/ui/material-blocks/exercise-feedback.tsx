import { Check, ChevronDown, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import type { ExerciseAnswerRecord } from "../../model/exercise-answers.client";

type ExerciseResult = ExerciseAnswerRecord["result"];

const resultLabels: Readonly<Record<ExerciseResult, string>> = {
  correct: "Правильно",
  incorrect: "Пока неверно",
  dontKnow: "Не знаю · без оценки",
};

/** How a checked option, row or step reads: tinted by `data-result`, never by words on screen. */
export type ItemResult = "correct" | "incorrect" | "missed";

/** What a screen reader hears for an item whose meaning the page shows only by colour. */
const itemResultSpeech: Readonly<Record<ItemResult, string>> = {
  correct: "Верно",
  incorrect: "Неверно",
  missed: "Верный ответ",
};

/**
 * The small glyph inside a tinted item, with the item's verdict for screen readers. The colour is
 * for sighted readers; the hidden words keep the meaning for assistive technology.
 */
export function ItemResultMark({
  result,
  speech = itemResultSpeech[result],
}: {
  readonly result: ItemResult;
  readonly speech?: string;
}) {
  return (
    <span className="flex shrink-0 items-center" data-item-mark={result}>
      {result === "incorrect" ? (
        <X aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
      ) : (
        <Check aria-hidden="true" className="size-3.5" strokeWidth={2.5} />
      )}
      <span className="sr-only">{speech}</span>
    </span>
  );
}

/**
 * The author's explanation of a checked item, folded under a quiet «Почему»: the page stays short,
 * and the explanation of every item opens with a click, a tap or the keyboard.
 */
export function ItemExplanation({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <details className="group/why mt-0.5 text-sm" data-item-explanation>
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-0.5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        Почему
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 transition-transform group-open/why:rotate-180"
        />
      </summary>
      <div className="pb-1 leading-normal text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

/**
 * The verdict bar under a checked exercise: one tinted line, «Правильно» or «Пока неверно: 2 из 4»,
 * with a quiet «Ответить ещё раз» beside it. The live region stays mounted, so the verdict is
 * announced when it appears.
 */
export function ExerciseVerdictBar({
  feedbackId,
  answered,
  score,
  retryLabel = "Ответить ещё раз",
  onRetry,
  children,
}: {
  readonly feedbackId: string;
  readonly answered: ExerciseAnswerRecord | null;
  /** «2 из 4» after an incorrect answer that has right items. */
  readonly score?: string | undefined;
  readonly retryLabel?: string;
  readonly onRetry: () => void;
  /** What follows the verdict after «Не знаю». */
  readonly children?: ReactNode;
}) {
  const result = answered?.result;
  return (
    <div data-exercise-feedback>
      <div
        data-exercise-verdict={result}
        className={
          result === undefined
            ? undefined
            : "mt-4 flex min-h-11 flex-wrap items-center justify-between gap-x-2 rounded-lg py-1 pl-3 pr-1"
        }
      >
        <p
          aria-live="polite"
          id={feedbackId}
          className="flex min-w-0 items-center gap-2 text-sm font-semibold"
        >
          {result === undefined ? null : (
            <>
              {result === "dontKnow" ? null : result === "correct" ? (
                <Check
                  aria-hidden="true"
                  className="size-4 shrink-0"
                  strokeWidth={2.5}
                />
              ) : (
                <X
                  aria-hidden="true"
                  className="size-4 shrink-0"
                  strokeWidth={2.5}
                />
              )}
              {result === "incorrect" && score !== undefined
                ? `${resultLabels.incorrect}: ${score}`
                : resultLabels[result]}
            </>
          )}
        </p>
        {result === undefined ? null : (
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 px-2.5 text-sm font-normal text-current hover:bg-transparent hover:text-current hover:underline hover:underline-offset-4 sm:px-3"
            onClick={onRetry}
          >
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {retryLabel}
          </Button>
        )}
      </div>
      {result === undefined ? null : children}
    </div>
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
      <div className="mt-3">{dontKnow.explanation}</div>
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
