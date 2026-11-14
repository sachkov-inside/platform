"use client";

import { checkExerciseAnswer } from "@inside/material-blocks";
import { ChevronDown, ChevronUp, GripVertical, RotateCcw } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
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
 * «Сопоставь». A choice is plain text: the site's drop-down list shows it as one item and wraps it
 * inside the screen on a phone.
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
          // Pairs are one to one: a choice another row holds waits until that row lets it go.
          const taken =
            mode === "pairs"
              ? new Set(
                  [...draft].flatMap(([otherRow, chosen]) =>
                    otherRow === row.id ? [] : [chosen],
                  ),
                )
              : new Set<string>();
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
              className="grid min-w-0 gap-2 rounded-lg border border-lesson-line bg-card px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,16rem)] sm:items-center sm:px-3"
            >
              <div id={rowId} className="min-w-0">
                {row.content}
              </div>
              <Select
                disabled={answered !== null}
                value={choice ?? ""}
                onValueChange={(value) => {
                  const next = new Map(draft);
                  next.set(row.id, value);
                  setDraft(next);
                }}
              >
                <SelectTrigger
                  aria-labelledby={rowId}
                  aria-describedby={answered === null ? undefined : reviewId}
                  data-match-choice
                  className="h-auto rounded-lg border-lesson-line bg-background py-2 text-base font-normal sm:text-sm disabled:opacity-100 [&>span:first-child]:whitespace-normal"
                >
                  <SelectValue placeholder="Выбери ответ" />
                </SelectTrigger>
                <SelectContent className="max-w-[min(var(--radix-select-content-available-width),calc(100vw-2rem))]">
                  {choices.map((item) => (
                    <SelectItem
                      key={item.id}
                      value={item.id}
                      disabled={taken.has(item.id)}
                      className="text-base font-normal sm:text-sm"
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

/** The order with the step at `from` taken out and put back at `to`. */
export function movedOrder(
  order: readonly string[],
  from: number,
  to: number,
): readonly string[] {
  const next = [...order];
  const [step] = next.splice(from, 1);
  if (step === undefined) return order;
  next.splice(to, 0, step);
  return next;
}

/**
 * Where a dragged step lands: the number of the other steps whose middle lies above the dragged
 * step's middle. `middles` are the other steps' middles, top to bottom.
 */
export function dropPosition(
  middles: readonly number[],
  draggedMiddle: number,
): number {
  return middles.filter((middle) => middle < draggedMiddle).length;
}

/** A step being dragged: which one, how far it moved, and where it would land now. */
interface StepDrag {
  readonly from: number;
  readonly offset: number;
  readonly to: number;
  /** Top of the drop line inside the list, in pixels. */
  readonly lineTop: number;
}

/**
 * Dragging a step by its handle, with a mouse or a finger. The list is measured once when the drag
 * starts; the other steps stay in place and a line shows where the step will land.
 */
function useStepDrag(onDrop: (from: number, to: number) => void) {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<StepDrag | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const start = (from: number, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || list.current === null) return;
    event.preventDefault();
    const top = list.current.getBoundingClientRect().top;
    const boxes = [...list.current.children].map((item) => {
      const box = item.getBoundingClientRect();
      return { top: box.top - top, bottom: box.bottom - top };
    });
    const dragged = boxes[from];
    if (dragged === undefined) return;
    const others = boxes.filter((_, index) => index !== from);
    const startY = event.clientY;
    const gap = 4;
    const measure = (offset: number): StepDrag => {
      const middle = (dragged.top + dragged.bottom) / 2 + offset;
      const to = dropPosition(
        others.map((box) => (box.top + box.bottom) / 2),
        middle,
      );
      const before = others[to];
      const after = others[to - 1];
      const lineTop =
        before === undefined ? (after?.bottom ?? 0) + gap : before.top - gap;
      return { from, offset, to, lineTop };
    };
    let current = measure(0);
    setDrag(current);
    const move = (moveEvent: PointerEvent) => {
      current = measure(moveEvent.clientY - startY);
      setDrag(current);
    };
    const finish = (dropped: boolean) => {
      stop.current?.();
      setDrag(null);
      if (dropped && current.to !== current.from)
        onDrop(current.from, current.to);
    };
    const up = () => {
      finish(true);
    };
    const cancel = () => {
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    stop.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      stop.current = null;
    };
  };

  return { list, drag, start };
}

/**
 * «Расставь по порядку»: the reader drags a step by its handle, or moves it with «Выше» and «Ниже»
 * or Alt + ↑ / ↓, so no drag is needed. Each move is announced. After «Проверить» the steps out of place are marked and every
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

  const { list, drag, start } = useStepDrag((from, to) => {
    const step = shown[from];
    if (step === undefined) return;
    setDraft(
      movedOrder(
        shown.map((item) => item.id),
        from,
        to,
      ),
    );
    setAnnouncement(
      `«${step.label}»: место ${String(to + 1)} из ${String(shown.length)}`,
    );
  });

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
          : "Перетащи шаги за ручку слева или расставь их кнопками «Выше» и «Ниже» (Alt + ↑ / ↓)."}
      </p>
      <div className="relative mt-3">
        <ol className="space-y-2" data-exercise-steps ref={list}>
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
                data-dragging={drag?.from === index ? "" : undefined}
                style={
                  drag?.from === index
                    ? { transform: `translateY(${String(drag.offset)}px)` }
                    : undefined
                }
                className={cn(
                  "relative grid min-w-0 items-center gap-2 rounded-lg border border-lesson-line bg-card py-2 pr-2.5 data-[result=out-of-place]:border-[var(--callout-bad)] data-dragging:z-10 data-dragging:shadow-card sm:pr-3",
                  answered === null
                    ? "grid-cols-[auto_auto_minmax(0,1fr)_auto] pl-0"
                    : "grid-cols-[auto_minmax(0,1fr)_auto] pl-2.5 sm:pl-3",
                )}
              >
                {answered === null ? (
                  <span
                    aria-hidden="true"
                    data-order-handle
                    onPointerDown={(event) => {
                      start(index, event);
                    }}
                    className="-my-2 flex min-h-11 w-7 cursor-grab touch-none items-center justify-center self-stretch rounded-l-lg text-muted-foreground hover:text-foreground active:cursor-grabbing"
                  >
                    <GripVertical className="size-4" />
                  </span>
                ) : null}
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
        {drag === null || drag.to === drag.from ? null : (
          <span
            aria-hidden="true"
            data-order-drop-line
            className="pointer-events-none absolute inset-x-0 h-0.5 -translate-y-1/2 rounded-full bg-lesson-graphite"
            style={{ top: drag.lineTop }}
          />
        )}
      </div>
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
