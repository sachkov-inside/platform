"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import {
  useExerciseAnswer,
  type ExerciseAnswerRecord,
} from "../../model/exercise-answers.client";
import {
  ExerciseDontKnowReview,
  ExerciseVerdictBar,
  ItemExplanation,
  ItemResultMark,
  type ItemResult,
} from "./exercise-feedback";
import { MaterialExerciseFrame } from "./material-exercise-frame";
import { exerciseCheckButtonClass } from "./exercise-check-button";
import { cn } from "@/shared/lib/utils";

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

type QuizOption = MaterialQuizPresentation["options"][number];

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

/**
 * How an option reads after a check. A chosen option is right or wrong; a correct option the reader
 * left out of a set, or the key after «Не знаю», reads as «missed». Other options stay neutral, so
 * a wrong single choice does not give the key away.
 */
function quizOptionResult(
  option: QuizOption,
  selectionMode: MaterialQuizPresentation["selectionMode"],
  answered: ExerciseAnswerRecord | null,
  chosen: readonly string[],
): ItemResult | undefined {
  if (answered === null) return undefined;
  if (answered.result === "dontKnow")
    return option.correct ? "missed" : undefined;
  if (chosen.includes(option.id))
    return option.correct ? "correct" : "incorrect";
  return selectionMode === "multiple" && option.correct ? "missed" : undefined;
}

/**
 * A quiz of a lesson. A checked answer stays on screen, its options tinted green or red with the
 * author's explanations folded under them, until the reader presses «Ответить ещё раз»; answers
 * come from the exercise answer source (#2121 stores them).
 */
export function MaterialQuiz(props: MaterialQuizPresentation) {
  const state = useExerciseAnswer(props.id);
  const quizId = useId();
  const answered = state.current;
  const chosen =
    answered?.answer.kind === "options" ? answered.answer.optionIds : [];
  const onCheck = (optionIds: readonly string[]) => {
    state.answer({
      answer: { kind: "options", optionIds: [...optionIds] },
      result: quizResult(props.options, optionIds),
    });
  };
  const dontKnowButton =
    props.dontKnow === undefined || answered !== null ? null : (
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
    );
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
          onCheck={onCheck}
          dontKnowButton={dontKnowButton}
        />
      ) : (
        <>
          <SingleChoice
            {...props}
            quizId={quizId}
            answered={answered}
            chosen={chosen}
            onCheck={onCheck}
          />
          {dontKnowButton === null ? null : (
            <div className="mt-3 flex flex-wrap gap-2">{dontKnowButton}</div>
          )}
        </>
      )}
      <ExerciseVerdictBar
        feedbackId={`${quizId}-feedback`}
        answered={answered}
        onRetry={state.retry}
      >
        {answered?.result === "dontKnow" && props.dontKnow !== undefined ? (
          <ExerciseDontKnowReview dontKnow={props.dontKnow} />
        ) : null}
      </ExerciseVerdictBar>
    </MaterialExerciseFrame>
  );
}

interface ChoiceProps extends MaterialQuizPresentation {
  readonly quizId: string;
  readonly answered: ExerciseAnswerRecord | null;
  readonly chosen: readonly string[];
  readonly onCheck: (optionIds: readonly string[]) => void;
}

const optionClass =
  "relative flex min-h-11 w-full gap-2.5 rounded-lg border border-lesson-line bg-card px-3 py-2.5 text-left text-lesson leading-[1.5] sm:px-4";

/** Content cell of an option: clicks pass to the option, links and «Почему» stay clickable. */
const optionContentClass =
  "pointer-events-none relative min-w-0 flex-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto [&_summary]:pointer-events-auto";

/** The option's text and, after a check, its folded explanation and its mark. */
function OptionBody({
  option,
  labelId,
  markId,
  result,
  explained,
}: {
  readonly option: QuizOption;
  readonly labelId: string;
  readonly markId: string;
  readonly result: ItemResult | undefined;
  readonly explained: boolean;
}) {
  return (
    <>
      <div className={optionContentClass}>
        <div id={labelId}>{option.content}</div>
        {explained && option.explanation !== undefined ? (
          <ItemExplanation>{option.explanation}</ItemExplanation>
        ) : null}
      </div>
      {result === undefined ? null : (
        <span id={markId} className="relative mt-1 self-start">
          <ItemResultMark result={result} />
        </span>
      )}
    </>
  );
}

/** One click answers: the chosen option turns green or red at once. */
function SingleChoice({
  options,
  selectionMode,
  quizId,
  answered,
  chosen,
  onCheck,
}: ChoiceProps) {
  return (
    <div className="mt-4 space-y-2" role="group" aria-label="Выберите ответ">
      {options.map((option, index) => {
        const result = quizOptionResult(
          option,
          selectionMode,
          answered,
          chosen,
        );
        const markId = `${quizId}-mark-${String(index)}`;
        const isChosen = chosen.includes(option.id);
        const described = [
          result === undefined ? undefined : markId,
          isChosen ? `${quizId}-feedback` : undefined,
        ].filter((id) => id !== undefined);
        return (
          <div
            key={option.id}
            data-quiz-option
            data-result={result}
            className={optionClass}
          >
            <button
              type="button"
              aria-pressed={isChosen}
              disabled={answered !== null}
              aria-labelledby={`${quizId}-number-${String(index)} ${quizId}-option-${String(index)}`}
              aria-describedby={
                described.length === 0 ? undefined : described.join(" ")
              }
              onClick={() => {
                onCheck([option.id]);
              }}
              className={`absolute inset-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring${answered === null ? " hover:bg-secondary/50" : ""}`}
            />
            <span
              id={`${quizId}-number-${String(index)}`}
              className="pointer-events-none relative tabular-nums text-muted-foreground"
            >
              {index + 1}
            </span>
            <OptionBody
              option={option}
              labelId={`${quizId}-option-${String(index)}`}
              markId={markId}
              result={result}
              explained={result !== undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Several correct options: the reader picks a set and checks it with «Проверить». A quiet
 * «Несколько ответов» tells that more than one option may be right.
 */
function MultipleChoice({
  options,
  selectionMode,
  quizId,
  answered,
  chosen,
  onCheck,
  dontKnowButton,
}: ChoiceProps & { readonly dontKnowButton: ReactNode }) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const shown = answered === null ? selected : chosen;
  return (
    <>
      {/* Each box is turned off on its own: a disabled fieldset would also keep «Почему» shut. */}
      <fieldset className="mt-4 min-w-0 space-y-2">
        <legend className="mb-2 text-xs text-muted-foreground sm:text-sm">
          Несколько ответов
        </legend>
        {options.map((option, index) => {
          const result = quizOptionResult(
            option,
            selectionMode,
            answered,
            chosen,
          );
          const markId = `${quizId}-mark-${String(index)}`;
          const inputId = `${quizId}-option-${String(index)}`;
          // The label covers the whole option, so a click anywhere ticks the box; «Почему» lies
          // outside it, above its cover, because a label would take that click.
          return (
            <div
              key={option.id}
              data-quiz-option
              data-result={result}
              className={`${optionClass} items-start${answered === null ? " hover:bg-secondary/50" : ""}`}
            >
              <input
                type="checkbox"
                id={inputId}
                checked={shown.includes(option.id)}
                disabled={answered !== null}
                aria-labelledby={`${quizId}-label-${String(index)}`}
                aria-describedby={result === undefined ? undefined : markId}
                className="relative mt-1 size-4 shrink-0 accent-lesson-graphite focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onChange={(event) => {
                  setSelected(
                    event.target.checked
                      ? [...selected, option.id]
                      : selected.filter((id) => id !== option.id),
                  );
                }}
              />
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={inputId}
                  id={`${quizId}-label-${String(index)}`}
                  className={`block after:absolute after:inset-0 after:rounded-lg [&_a]:relative [&_a]:z-[1]${answered === null ? " cursor-pointer" : ""}`}
                >
                  {option.content}
                </label>
                {answered !== null && option.explanation !== undefined ? (
                  <div className="relative z-[1]">
                    <ItemExplanation>{option.explanation}</ItemExplanation>
                  </div>
                ) : null}
              </div>
              {result === undefined ? null : (
                <span id={markId} className="relative mt-1 self-start">
                  <ItemResultMark result={result} />
                </span>
              )}
            </div>
          );
        })}
      </fieldset>
      {answered !== null ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            className={cn("min-h-11", exerciseCheckButtonClass)}
            disabled={selected.length === 0}
            onClick={() => {
              onCheck(selected);
              setSelected([]);
            }}
          >
            Проверить
          </Button>
          {dontKnowButton}
        </div>
      )}
    </>
  );
}
