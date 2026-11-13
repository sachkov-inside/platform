"use client";

import { checkExerciseAnswer } from "@inside/material-blocks";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/shared/ui/button";
import {
  useExerciseAnswer,
  type ExerciseAnswerRecord,
  type ExerciseAnswerState,
} from "../../model/exercise-answers.client";
import {
  ExerciseDontKnowReview,
  ExerciseVerdict,
  ResultIcon,
} from "./exercise-feedback";
import { MaterialExerciseFrame } from "./material-exercise-frame";

/** What the author wrote for «Не знаю». */
interface DontKnow {
  readonly explanation: ReactNode;
  readonly reviewLinks: readonly string[];
}

/** Fields every exercise shares; rich parts are already rendered by the calling surface. */
interface ExercisePresentation {
  readonly id: string;
  readonly heading: string;
  readonly context?: ReactNode;
  readonly question: ReactNode;
  readonly dontKnow?: DontKnow;
}

/**
 * «Сопоставь». A choice is plain text, because a native drop-down list shows only text; on a
 * phone it opens the system picker, which never runs wider than the screen.
 */
export interface MaterialMatchPresentation extends ExercisePresentation {
  /** `pairs`: one row per choice. `groups`: several rows share a group (2-3 groups). */
  readonly mode: "pairs" | "groups";
  readonly rows: readonly {
    readonly id: string;
    readonly content: ReactNode;
    readonly answerId: string;
    readonly explanation: ReactNode;
  }[];
  readonly choices: readonly { readonly id: string; readonly label: string }[];
}

/** «Расставь по порядку». `steps` come in the correct order; the reader gets them shuffled. */
export interface MaterialOrderPresentation extends ExercisePresentation {
  readonly steps: readonly {
    readonly id: string;
    readonly content: ReactNode;
    /** Plain text of the step for the announcement after a move. */
    readonly label: string;
    readonly explanation: ReactNode;
  }[];
}

const buttonClass = "min-h-11 px-2.5 text-sm sm:px-3";

/**
 * Buttons under a checked or unchecked exercise. «Начать заново» and «Ответить ещё раз» clear only
 * the shown answer: the recorded attempt stays, and text the answer opened stays open (#2122).
 */
function ExerciseActions({
  state,
  canCheck,
  onCheck,
  dontKnow,
  retryLabel,
  onRetry,
}: {
  readonly state: ExerciseAnswerState;
  readonly canCheck: boolean;
  readonly onCheck: () => void;
  readonly dontKnow: boolean;
  readonly retryLabel: string;
  readonly onRetry: () => void;
}) {
  if (state.current !== null)
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          className={buttonClass}
          variant="ghost"
          onClick={() => {
            onRetry();
            state.retry();
          }}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          {retryLabel}
        </Button>
      </div>
    );
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        type="button"
        className={buttonClass}
        disabled={!canCheck}
        onClick={onCheck}
      >
        Проверить
      </Button>
      {dontKnow ? (
        <Button
          type="button"
          className={buttonClass}
          variant="ghost"
          onClick={() => {
            state.answer({ answer: { kind: "dontKnow" }, result: "dontKnow" });
          }}
        >
          Не знаю
        </Button>
      ) : null}
    </div>
  );
}

/** Verdict of one row or step, the right answer when it differs, and the author's explanation. */
function ItemReview({
  id,
  correct,
  verdict,
  hint,
  explanation,
}: {
  readonly id: string;
  /** Undefined after «Не знаю»: nothing was answered, so nothing is right or wrong. */
  readonly correct: boolean | undefined;
  readonly verdict: string | undefined;
  readonly hint: string | undefined;
  readonly explanation: ReactNode;
}) {
  return (
    <div id={id} className="col-span-full mt-1 text-sm" data-item-review>
      {correct === undefined ? null : (
        <p
          className="flex items-center gap-1 font-semibold"
          style={{
            color: correct ? "var(--callout-good)" : "var(--callout-bad)",
          }}
        >
          <ResultIcon correct={correct} />
          {verdict}
        </p>
      )}
      {hint === undefined ? null : <p className="font-semibold">{hint}</p>}
      <div className="mt-1">{explanation}</div>
    </div>
  );
}

function Feedback({
  feedbackId,
  answered,
  score,
  dontKnow,
}: {
  readonly feedbackId: string;
  readonly answered: ExerciseAnswerRecord | null;
  readonly score: string;
  readonly dontKnow: DontKnow | undefined;
}) {
  return (
    <div aria-live="polite" id={feedbackId}>
      {answered === null ? null : (
        <div
          className="mt-3 border-t border-border pt-3"
          data-exercise-feedback
        >
          <ExerciseVerdict result={answered.result} score={score} />
          {answered.result === "dontKnow" && dontKnow !== undefined ? (
            <ExerciseDontKnowReview dontKnow={dontKnow} />
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * «Сопоставь»: a drop-down list at each row. After «Проверить» every row shows its verdict and
 * explanation; «Начать заново» empties the lists. Answers go to the exercise answer source.
 */
export function MaterialMatch(props: MaterialMatchPresentation) {
  const { id, mode, rows, choices } = props;
  const state = useExerciseAnswer(id);
  const baseId = useId();
  const [draft, setDraft] = useState<ReadonlyMap<string, string>>(new Map());
  const answered = state.current;
  const known = new Set(choices.map((choice) => choice.id));
  // A past answer to an older version may name choices that are gone: those rows read as empty.
  const picked: ReadonlyMap<string, string> =
    answered === null
      ? draft
      : new Map(
          answered.answer.kind === "matches"
            ? answered.answer.matches
                .filter((match) => known.has(match.choiceId))
                .map((match) => [match.rowId, match.choiceId])
            : [],
        );
  const labels = new Map(choices.map((choice) => [choice.id, choice.label]));
  const rightRows = rows.filter((row) => picked.get(row.id) === row.answerId);
  const feedbackId = `${baseId}-feedback`;

  const check = () => {
    const answer = {
      kind: "matches" as const,
      matches: rows.map((row) => ({
        rowId: row.id,
        choiceId: draft.get(row.id) ?? "",
      })),
    };
    state.answer({
      answer,
      result:
        checkExerciseAnswer({ kind: "match", mode, rows, choices }, answer) ??
        "incorrect",
    });
  };

  return (
    <MaterialExerciseFrame
      exerciseId={id}
      kind="match"
      updated={state.updated}
      note={state.note}
      heading={props.heading}
      context={props.context}
      question={props.question}
    >
      <p className="mt-3 text-sm text-muted-foreground">
        {mode === "groups"
          ? "Выбери группу для каждой строки. В одну группу может попасть несколько строк."
          : "Выбери ответ для каждой строки. Каждый ответ подходит только к одной строке."}
      </p>
      <ol className="mt-3 space-y-2" data-exercise-rows>
        {rows.map((row, index) => {
          const rowId = `${baseId}-row-${String(index)}`;
          const reviewId = `${baseId}-review-${String(index)}`;
          const choice = picked.get(row.id);
          const correct =
            answered === null || answered.result === "dontKnow"
              ? undefined
              : choice === row.answerId;
          return (
            <li
              key={row.id}
              data-match-row
              data-result={
                correct === undefined
                  ? undefined
                  : correct
                    ? "correct"
                    : "incorrect"
              }
              className="grid min-w-0 gap-2 rounded-lg border border-border bg-card px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,16rem)] sm:items-center sm:px-3"
            >
              <div id={rowId} className="min-w-0">
                {row.content}
              </div>
              <select
                aria-labelledby={rowId}
                aria-describedby={answered === null ? undefined : reviewId}
                disabled={answered !== null}
                value={choice ?? ""}
                onChange={(event) => {
                  const next = new Map(draft);
                  if (event.target.value === "") next.delete(row.id);
                  else next.set(row.id, event.target.value);
                  setDraft(next);
                }}
                className="min-h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-base text-foreground sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-100"
              >
                <option value="">Выбери ответ</option>
                {choices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              {answered === null ? null : (
                <ItemReview
                  id={reviewId}
                  correct={correct}
                  verdict={correct === true ? "Верно" : "Неверно"}
                  hint={
                    correct === true
                      ? undefined
                      : `Верный ответ: ${labels.get(row.answerId) ?? ""}`
                  }
                  explanation={row.explanation}
                />
              )}
            </li>
          );
        })}
      </ol>
      <ExerciseActions
        state={state}
        canCheck={rows.every((row) => draft.has(row.id))}
        onCheck={check}
        dontKnow={props.dontKnow !== undefined}
        retryLabel="Начать заново"
        onRetry={() => {
          setDraft(new Map());
        }}
      />
      <Feedback
        feedbackId={feedbackId}
        answered={answered}
        score={`${String(rightRows.length)} из ${String(rows.length)}`}
        dontKnow={props.dontKnow}
      />
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
 * The steps in the given order. A past answer to an older version may skip new steps or name
 * removed ones: removed ids are dropped and new steps go to the end in their shuffled place.
 */
export function arrangedSteps<Step extends { readonly id: string }>(
  exerciseId: string,
  steps: readonly Step[],
  order: readonly string[] | null,
): readonly Step[] {
  const shuffled = shuffledSteps(exerciseId, steps);
  if (order === null) return shuffled;
  const byId = new Map(steps.map((step) => [step.id, step]));
  const placed = [...new Set(order)].flatMap((stepId) => {
    const step = byId.get(stepId);
    return step === undefined ? [] : [step];
  });
  const placedIds = new Set(placed.map((step) => step.id));
  return [...placed, ...shuffled.filter((step) => !placedIds.has(step.id))];
}

type Direction = "up" | "down";

/**
 * «Расставь по порядку»: the reader moves steps with «Выше» and «Ниже» or Alt + ↑ / ↓; no drag is
 * needed. Each move is announced. After «Проверить» the steps out of place are marked and every
 * step shows why it stands where it does; «Ответить ещё раз» starts from the reader's last checked
 * order, restored after a reload too, so only the marked steps need moving.
 */
export function MaterialOrder(props: MaterialOrderPresentation) {
  const { id, steps } = props;
  const state = useExerciseAnswer(id);
  const baseId = useId();
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  const answered = state.current;
  const shown =
    answered === null
      ? arrangedSteps(id, steps, draft)
      : answered.answer.kind === "sequence"
        ? arrangedSteps(id, steps, answered.answer.stepIds)
        : steps;
  const position = new Map(steps.map((step, index) => [step.id, index]));
  const inPlace = shown.filter(
    (step, index) => position.get(step.id) === index,
  );

  // A moved step keeps the focus on its button; at the edge the other button takes it.
  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    const button = buttons.current.get(key);
    if (button?.disabled === false) {
      button.focus();
      return;
    }
    const [stepId, direction] = key.split(":");
    buttons.current
      .get(`${stepId ?? ""}:${direction === "up" ? "down" : "up"}`)
      ?.focus();
  });

  const move = (index: number, direction: Direction) => {
    const target = direction === "up" ? index - 1 : index + 1;
    const step = shown[index];
    const other = shown[target];
    if (step === undefined || other === undefined) return;
    const next = shown.map((item) => item.id);
    next[index] = other.id;
    next[target] = step.id;
    setDraft(next);
    pendingFocus.current = `${step.id}:${direction}`;
    setAnnouncement(
      `«${step.label}»: место ${String(target + 1)} из ${String(shown.length)}`,
    );
  };

  const check = () => {
    const answer = {
      kind: "sequence" as const,
      stepIds: shown.map((step) => step.id),
    };
    setAnnouncement("");
    state.answer({
      answer,
      result:
        checkExerciseAnswer({ kind: "order", steps }, answer) ?? "incorrect",
    });
  };

  const dontKnow = answered?.result === "dontKnow";
  return (
    <MaterialExerciseFrame
      exerciseId={id}
      kind="order"
      updated={state.updated}
      note={state.note}
      heading={props.heading}
      context={props.context}
      question={props.question}
    >
      <p className="mt-3 text-sm text-muted-foreground">
        {dontKnow
          ? "Верный порядок:"
          : "Расставь шаги кнопками «Выше» и «Ниже» или клавишами Alt + ↑ / ↓."}
      </p>
      <ol className="mt-3 space-y-2" data-exercise-steps>
        {shown.map((step, index) => {
          const labelId = `${baseId}-step-${String(index)}`;
          const reviewId = `${baseId}-review-${String(index)}`;
          const correct =
            answered === null || dontKnow
              ? undefined
              : position.get(step.id) === index;
          return (
            <li
              key={step.id}
              data-order-step
              data-result={
                correct === undefined
                  ? undefined
                  : correct
                    ? "in-place"
                    : "out-of-place"
              }
              aria-describedby={answered === null ? undefined : reviewId}
              onKeyDown={(event) => {
                if (answered !== null || !event.altKey) return;
                const direction =
                  event.key === "ArrowUp"
                    ? "up"
                    : event.key === "ArrowDown"
                      ? "down"
                      : undefined;
                if (direction === undefined) return;
                event.preventDefault();
                move(index, direction);
              }}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 data-[result=out-of-place]:border-[var(--callout-bad)] sm:px-3"
            >
              <span className="font-semibold tabular-nums">{index + 1}.</span>
              <div id={labelId} className="min-w-0">
                {step.content}
              </div>
              {answered === null ? (
                <div className="flex gap-1">
                  <MoveButton
                    direction="up"
                    labelId={labelId}
                    disabled={index === 0}
                    register={(element) => {
                      if (element === null)
                        buttons.current.delete(`${step.id}:up`);
                      else buttons.current.set(`${step.id}:up`, element);
                    }}
                    onClick={() => {
                      move(index, "up");
                    }}
                  />
                  <MoveButton
                    direction="down"
                    labelId={labelId}
                    disabled={index === shown.length - 1}
                    register={(element) => {
                      if (element === null)
                        buttons.current.delete(`${step.id}:down`);
                      else buttons.current.set(`${step.id}:down`, element);
                    }}
                    onClick={() => {
                      move(index, "down");
                    }}
                  />
                </div>
              ) : (
                <span />
              )}
              {answered === null ? null : (
                <ItemReview
                  id={reviewId}
                  correct={correct}
                  verdict={correct === true ? "На месте" : "Не на месте"}
                  hint={
                    correct === false
                      ? `Место этого шага: ${String((position.get(step.id) ?? 0) + 1)}`
                      : undefined
                  }
                  explanation={step.explanation}
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only" aria-live="polite" data-order-announcement>
        {announcement}
      </p>
      <ExerciseActions
        state={state}
        canCheck
        onCheck={check}
        dontKnow={props.dontKnow !== undefined}
        retryLabel="Ответить ещё раз"
        onRetry={() => {
          // The last checked order, saved or just given, is where answering again starts. After
          // «Не знаю» the page showed the key, so the steps start shuffled again.
          setDraft(
            answered?.answer.kind === "sequence"
              ? shown.map((step) => step.id)
              : null,
          );
        }}
      />
      <Feedback
        feedbackId={`${baseId}-feedback`}
        answered={answered}
        score={`на месте ${String(inPlace.length)} из ${String(steps.length)}`}
        dontKnow={props.dontKnow}
      />
    </MaterialExerciseFrame>
  );
}

function MoveButton({
  direction,
  labelId,
  disabled,
  register,
  onClick,
}: {
  readonly direction: Direction;
  readonly labelId: string;
  readonly disabled: boolean;
  readonly register: (element: HTMLButtonElement | null) => void;
  readonly onClick: () => void;
}) {
  const nameId = useId();
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  return (
    <Button
      ref={register}
      type="button"
      variant="ghost"
      size="icon-lg"
      disabled={disabled}
      aria-labelledby={`${nameId} ${labelId}`}
      aria-keyshortcuts={direction === "up" ? "Alt+ArrowUp" : "Alt+ArrowDown"}
      onClick={onClick}
      className="text-muted-foreground disabled:opacity-35"
    >
      <span id={nameId} className="sr-only">
        {direction === "up" ? "Выше" : "Ниже"}
      </span>
      <Icon aria-hidden="true" className="size-4" />
    </Button>
  );
}
