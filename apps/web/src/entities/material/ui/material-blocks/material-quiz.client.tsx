"use client";

import { useId, useState, type ReactNode } from "react";
import { Check, CircleHelp, RotateCcw, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  useExerciseAnswer,
  type ExerciseAnswerRecord,
} from "../../model/exercise-answers.client";
import { MaterialExerciseFrame } from "./material-exercise-frame";

/** Prepared reading content shared by Reader and its stories. */
export interface MaterialQuizPresentation {
  readonly id: string;
  readonly heading: string;
  readonly context?: ReactNode;
  readonly question: ReactNode;
  readonly selectionMode: "single" | "multiple";
  readonly options: readonly {
    readonly id: string;
    readonly content: ReactNode;
    readonly correct: boolean;
    readonly explanation?: ReactNode;
  }[];
  readonly dontKnow?: {
    readonly explanation: ReactNode;
    readonly reviewLinks: readonly string[];
  };
}

/** Correct only when the chosen set equals the correct set; order does not matter. */
function quizResult(
  options: MaterialQuizPresentation["options"],
  chosen: readonly string[],
): ExerciseAnswerRecord["result"] {
  const correct = options.filter((option) => option.correct);
  return chosen.length === correct.length &&
    correct.every((option) => chosen.includes(option.id))
    ? "correct"
    : "incorrect";
}

const resultLabels: Readonly<Record<ExerciseAnswerRecord["result"], string>> = {
  correct: "Правильно",
  incorrect: "Пока неверно",
  dontKnow: "Не знаю · без оценки",
};

const resultColors: Readonly<Record<ExerciseAnswerRecord["result"], string>> = {
  correct: "var(--callout-good)",
  incorrect: "var(--callout-bad)",
  dontKnow: "var(--foreground)",
};

/**
 * A quiz of a lesson. A checked answer stays on screen with its explanations until the reader
 * presses «Ответить ещё раз»; answers come from the exercise answer source (#2121 stores them).
 */
export function MaterialQuiz(props: MaterialQuizPresentation) {
  const state = useExerciseAnswer(props.id);
  const quizId = useId();
  const answered = state.current;
  const chosen =
    answered?.answer.kind === "options" ? answered.answer.optionIds : [];
  return (
    <MaterialExerciseFrame
      exerciseId={props.id}
      kind="quiz"
      updated={state.updated}
      note={state.note}
      heading={props.heading}
      context={props.context}
      question={props.question}
    >
      {props.selectionMode === "multiple" ? (
        <MultipleChoice
          {...props}
          quizId={quizId}
          answered={answered}
          chosen={chosen}
          onCheck={(optionIds) => {
            state.answer({
              answer: { kind: "options", optionIds: [...optionIds] },
              result: quizResult(props.options, optionIds),
            });
          }}
        />
      ) : (
        <SingleChoice
          {...props}
          quizId={quizId}
          answered={answered}
          chosen={chosen}
          onCheck={(optionIds) => {
            state.answer({
              answer: { kind: "options", optionIds: [...optionIds] },
              result: quizResult(props.options, optionIds),
            });
          }}
        />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {props.dontKnow === undefined || answered !== null ? null : (
          <Button
            type="button"
            className="min-h-11 px-2.5 text-sm sm:px-3"
            variant="ghost"
            onClick={() => {
              state.answer({
                answer: { kind: "dontKnow" },
                result: "dontKnow",
              });
            }}
          >
            Не знаю
          </Button>
        )}
        {answered === null ? null : (
          <Button
            type="button"
            className="min-h-11 px-2.5 text-sm sm:px-3"
            variant="ghost"
            onClick={state.retry}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            Ответить ещё раз
          </Button>
        )}
      </div>
      <div aria-live="polite" id={`${quizId}-feedback`}>
        {answered === null ? null : (
          <QuizFeedback {...props} answered={answered} chosen={chosen} />
        )}
      </div>
    </MaterialExerciseFrame>
  );
}

interface ChoiceProps extends MaterialQuizPresentation {
  readonly quizId: string;
  readonly answered: ExerciseAnswerRecord | null;
  readonly chosen: readonly string[];
  readonly onCheck: (optionIds: readonly string[]) => void;
}

/** One click answers: the chosen option turns green or red at once. */
function SingleChoice({
  options,
  quizId,
  answered,
  chosen,
  onCheck,
}: ChoiceProps) {
  return (
    <div className="mt-4 space-y-2" role="group" aria-label="Выберите ответ">
      {options.map((option, index) => {
        const isChosen = chosen.includes(option.id);
        const optionResult = !isChosen
          ? undefined
          : option.correct
            ? "correct"
            : "incorrect";
        return (
          <div
            key={option.id}
            data-quiz-option
            data-result={optionResult}
            className="relative flex min-h-11 w-full gap-2 rounded-lg border border-border bg-card px-2.5 py-2 pr-8 text-left text-sm leading-[1.5] sm:px-3 sm:pr-9 sm:text-base"
          >
            <button
              type="button"
              aria-pressed={isChosen}
              disabled={answered !== null}
              aria-labelledby={`${quizId}-number-${String(index)} ${quizId}-option-${String(index)}`}
              aria-describedby={isChosen ? `${quizId}-feedback` : undefined}
              onClick={() => {
                onCheck([option.id]);
              }}
              className={`absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring${answered === null ? " hover:bg-secondary/50" : ""}`}
            />
            <span
              id={`${quizId}-number-${String(index)}`}
              className="pointer-events-none relative font-semibold"
            >
              {index + 1}.
            </span>
            <div
              id={`${quizId}-option-${String(index)}`}
              className="pointer-events-none relative min-w-0 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_summary]:pointer-events-auto"
            >
              {option.content}
            </div>
            {optionResult === undefined ? null : optionResult === "correct" ? (
              <Check
                aria-hidden="true"
                className="absolute right-3 top-3 size-4"
              />
            ) : (
              <X aria-hidden="true" className="absolute right-3 top-3 size-4" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Several correct options: the reader picks a set and checks it with «Проверить». */
function MultipleChoice({
  options,
  quizId,
  answered,
  chosen,
  onCheck,
}: ChoiceProps) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const shown = answered === null ? selected : chosen;
  return (
    <>
      <fieldset className="mt-4 min-w-0 space-y-2" disabled={answered !== null}>
        <legend className="mb-2 text-sm text-muted-foreground">
          Выбери все подходящие варианты.
        </legend>
        {options.map((option, index) => (
          <label
            key={option.id}
            htmlFor={`${quizId}-option-${String(index)}`}
            data-quiz-option
            className="relative flex min-h-11 w-full cursor-pointer items-start gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left text-sm leading-[1.5] sm:px-3 sm:text-base"
          >
            <input
              type="checkbox"
              id={`${quizId}-option-${String(index)}`}
              checked={shown.includes(option.id)}
              aria-labelledby={`${quizId}-label-${String(index)}`}
              aria-describedby={
                answered === null
                  ? undefined
                  : `${quizId}-explanation-${String(index)}`
              }
              className="relative mt-1 size-4 shrink-0 accent-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onChange={(event) => {
                setSelected(
                  event.target.checked
                    ? [...selected, option.id]
                    : selected.filter((id) => id !== option.id),
                );
              }}
            />
            <div className="pointer-events-none relative min-w-0 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_summary]:pointer-events-auto">
              <div id={`${quizId}-label-${String(index)}`}>
                {option.content}
              </div>
              {answered === null ? null : (
                <div
                  id={`${quizId}-explanation-${String(index)}`}
                  className="mt-2 text-sm"
                >
                  <p className="flex items-center gap-1 font-semibold">
                    {option.correct ? (
                      <Check aria-hidden="true" className="size-4" />
                    ) : (
                      <X aria-hidden="true" className="size-4" />
                    )}
                    {option.correct ? "Подходит" : "Не подходит"}
                  </p>
                  {option.explanation === undefined ? null : (
                    <div className="mt-1">{option.explanation}</div>
                  )}
                </div>
              )}
            </div>
          </label>
        ))}
      </fieldset>
      {answered !== null ? null : (
        <div className="mt-3">
          <Button
            type="button"
            disabled={selected.length === 0}
            onClick={() => {
              onCheck(selected);
              setSelected([]);
            }}
          >
            Проверить
          </Button>
        </div>
      )}
    </>
  );
}

function QuizFeedback({
  selectionMode,
  options,
  dontKnow,
  answered,
  chosen,
}: MaterialQuizPresentation & {
  readonly answered: ExerciseAnswerRecord;
  readonly chosen: readonly string[];
}) {
  const correct = options.filter((option) => option.correct);
  const selected = options.find((option) => option.id === chosen[0]);
  return (
    <div className="mt-3 border-t border-border pt-3" data-quiz-feedback>
      <p
        className="flex items-center gap-2 text-sm font-semibold"
        style={{ color: resultColors[answered.result] }}
      >
        {answered.result === "dontKnow" ? (
          <CircleHelp aria-hidden="true" className="size-4" />
        ) : answered.result === "correct" ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <X aria-hidden="true" className="size-4" />
        )}
        {resultLabels[answered.result]}
      </p>
      {answered.result === "dontKnow" ? (
        <>
          {/* Several correct options are marked beside each option already. */}
          {selectionMode === "multiple" ? null : (
            <>
              <p className="mt-2 text-sm font-semibold">Правильный ответ:</p>
              {correct.map((option) => (
                <div key={option.id} className="mt-1">
                  {option.content}
                  {option.explanation === undefined ? null : (
                    <div className="mt-2">{option.explanation}</div>
                  )}
                </div>
              ))}
            </>
          )}
          {dontKnow === undefined ? null : (
            <>
              <div className="mt-2">{dontKnow.explanation}</div>
              {dontKnow.reviewLinks.map((href, index) => (
                <a
                  key={href}
                  href={href}
                  className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
                >
                  Повторить раздел
                  {dontKnow.reviewLinks.length > 1
                    ? ` ${String(index + 1)}`
                    : ""}
                </a>
              ))}
            </>
          )}
        </>
      ) : selectionMode === "single" && selected?.explanation !== undefined ? (
        <div className="mt-2">{selected.explanation}</div>
      ) : null}
    </div>
  );
}
