"use client";

import { checkExerciseAnswer } from "@inside/material-blocks";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
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
  type ExerciseAnswerState,
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

/** «Проверить» and «Не знаю» under an exercise not checked yet. */
function ExerciseActions({
  state,
  canCheck,
  onCheck,
  dontKnow,
}: {
  readonly state: ExerciseAnswerState;
  readonly canCheck: boolean;
  readonly onCheck: () => void;
  readonly dontKnow: boolean;
}) {
  if (state.current !== null) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button
        type="button"
        className={cn(buttonClass, exerciseCheckButtonClass)}
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

/**
 * The verdict bar of a checked exercise. «Начать заново» and «Ответить ещё раз» clear only the
 * shown answer: the recorded attempt stays, and text the answer opened stays open (#2122).
 */
function Feedback({
  feedbackId,
  state,
  score,
  dontKnow,
  retryLabel,
  onRetry,
}: {
  readonly feedbackId: string;
  readonly state: ExerciseAnswerState;
  readonly score: string;
  readonly dontKnow: DontKnow | undefined;
  readonly retryLabel: string;
  readonly onRetry: () => void;
}) {
  const answered = state.current;
  return (
    <ExerciseVerdictBar
      feedbackId={feedbackId}
      answered={answered}
      score={score}
      retryLabel={retryLabel}
      onRetry={() => {
        onRetry();
        state.retry();
      }}
    >
      {answered?.result === "dontKnow" && dontKnow !== undefined ? (
        <ExerciseDontKnowReview dontKnow={dontKnow} />
      ) : null}
    </ExerciseVerdictBar>
  );
}

/**
 * The quiet line under a checked row or step: the right answer when it differs, after a «→» that a
 * screen reader hears as words, and the author's explanation folded under «Почему».
 */
function ItemReview({
  id,
  answer,
  answerSpeech,
  explanation,
}: {
  readonly id: string;
  readonly answer: string | undefined;
  /** What a screen reader hears in place of the arrow. */
  readonly answerSpeech: string;
  readonly explanation: ReactNode;
}) {
  return (
    <div className="col-span-full min-w-0" data-item-review>
      {answer === undefined ? null : (
        <p id={id} className="text-sm text-muted-foreground">
          <span aria-hidden="true">→ </span>
          <span className="sr-only">{answerSpeech}</span>
          {answer}
        </p>
      )}
      <ItemExplanation>{explanation}</ItemExplanation>
    </div>
  );
}

/**
 * «Сопоставь»: a drop-down list at each row. After «Проверить» each row shows the chosen answer as
 * plain text, turns green or red, names the right answer after «→» when it differs and folds its
 * explanation under «Почему»; «Начать заново» empties the lists. Answers go to the exercise answer
 * source.
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
      <ol className="mt-4 space-y-2" data-exercise-rows>
        {rows.map((row, index) => {
          const rowId = `${baseId}-row-${String(index)}`;
          const reviewId = `${baseId}-review-${String(index)}`;
          const markId = `${baseId}-mark-${String(index)}`;
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
          // After «Не знаю» the row shows its key, tinted like a missed answer.
          const result: ItemResult | undefined =
            answered === null
              ? undefined
              : answered.result === "dontKnow"
                ? "missed"
                : choice === row.answerId
                  ? "correct"
                  : "incorrect";
          const answerLabel = labels.get(row.answerId) ?? "";
          return (
            <li
              key={row.id}
              data-match-row
              data-result={result}
              className={cn(
                "grid min-w-0 gap-x-3 rounded-lg border border-lesson-line bg-card px-3 py-2.5 sm:px-4",
                result === undefined
                  ? "gap-y-2 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,16rem)] sm:items-center"
                  : "grid-cols-[minmax(0,1fr)_auto] items-start gap-y-0.5",
              )}
            >
              <div id={rowId} className="min-w-0">
                {row.content}
              </div>
              {result === undefined ? (
                <Select
                  value={choice ?? ""}
                  onValueChange={(value) => {
                    const next = new Map(draft);
                    next.set(row.id, value);
                    setDraft(next);
                  }}
                >
                  <SelectTrigger
                    aria-labelledby={rowId}
                    data-match-choice
                    className="h-auto rounded-lg py-2 text-lesson font-normal [&>span:first-child]:whitespace-normal"
                  >
                    <SelectValue placeholder="Выбери ответ" />
                  </SelectTrigger>
                  <SelectContent className="max-w-[min(var(--radix-select-content-available-width),calc(100vw-2rem))]">
                    {choices.map((item) => (
                      <SelectItem
                        key={item.id}
                        value={item.id}
                        disabled={taken.has(item.id)}
                        className="text-lesson font-normal"
                      >
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="flex max-w-[45vw] items-center gap-2 sm:max-w-64">
                  <span
                    data-match-choice
                    className="min-w-0 rounded-md bg-background/70 px-2 py-0.5 text-sm"
                  >
                    <span className="sr-only">
                      {result === "missed" ? "Верный ответ: " : "Ответ: "}
                    </span>
                    {result === "missed"
                      ? answerLabel
                      : choice === undefined
                        ? "Без ответа"
                        : (labels.get(choice) ?? "Без ответа")}
                  </span>
                  <span id={markId} className="shrink-0">
                    <ItemResultMark result={result} />
                  </span>
                </span>
              )}
              {result === undefined ? null : (
                <ItemReview
                  id={reviewId}
                  answer={result === "incorrect" ? answerLabel : undefined}
                  answerSpeech="Верный ответ: "
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
      />
      <Feedback
        feedbackId={feedbackId}
        state={state}
        score={`${String(rightRows.length)} из ${String(rows.length)}`}
        dontKnow={props.dontKnow}
        retryLabel="Начать заново"
        onRetry={() => {
          setDraft(new Map());
        }}
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
 * or Alt + ↑ / ↓, so no drag is needed; the buttons show on hover and focus. Each move is
 * announced. After «Проверить» a step in place turns green, a step out of place turns red with its
 * right place as «→ 2», and every step folds why it stands there under «Почему»; «Ответить ещё раз»
 * starts from the reader's last checked order, restored after a reload too, so only the marked
 * steps need moving.
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
      {dontKnow ? (
        <p className="mt-4 text-sm text-muted-foreground">Верный порядок</p>
      ) : answered === null ? (
        <p className="sr-only" id={`${baseId}-how`}>
          Шаги переставляются кнопками «Выше» и «Ниже» или клавишами Alt + ↑ /
          ↓.
        </p>
      ) : null}
      <div className="relative mt-4">
        <ol
          className="space-y-2"
          data-exercise-steps
          ref={list}
          aria-describedby={answered === null ? `${baseId}-how` : undefined}
        >
          {shown.map((step, index) => {
            const labelId = `${baseId}-step-${String(index)}`;
            const reviewId = `${baseId}-review-${String(index)}`;
            const correct =
              answered === null || dontKnow
                ? undefined
                : position.get(step.id) === index;
            const place = (position.get(step.id) ?? 0) + 1;
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
                aria-describedby={correct === undefined ? undefined : reviewId}
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
                  "relative grid min-w-0 gap-x-2.5 rounded-lg border border-lesson-line bg-card py-2 pr-1.5 data-dragging:z-10 data-dragging:shadow-card",
                  answered === null
                    ? "grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center pl-0"
                    : "grid-cols-[auto_minmax(0,1fr)_auto] items-start py-2.5 pl-3 pr-3 sm:pl-4 sm:pr-4",
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
                <span className="tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div id={labelId}>{step.content}</div>
                  {answered === null ? null : (
                    <ItemExplanation>{step.explanation}</ItemExplanation>
                  )}
                </div>
                {answered === null ? (
                  <div className="flex" data-order-moves>
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
                ) : correct === undefined ? (
                  <span />
                ) : correct ? (
                  <span id={reviewId} className="mt-1">
                    <ItemResultMark result="correct" speech="На месте" />
                  </span>
                ) : (
                  <span
                    id={reviewId}
                    data-item-mark="incorrect"
                    data-order-place={place}
                    className="mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums"
                  >
                    <span aria-hidden="true">→ {place}</span>
                    <span className="sr-only">
                      Не на месте, место этого шага: {place}
                    </span>
                  </span>
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
      />
      <Feedback
        feedbackId={`${baseId}-feedback`}
        state={state}
        score={`на месте ${String(inPlace.length)} из ${String(steps.length)}`}
        dontKnow={props.dontKnow}
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
