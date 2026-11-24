"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

import {
  useProgressReset,
  type ProgressResetStatus,
} from "@/features/reading-progress";
import { Button } from "@/shared/ui/button";

import { useChapterReading } from "./chapter-reading-progress.client";
import styles from "./chapter-progress-reset.module.css";
import { formatLessonsGenitive } from "./product-counts";

/** The bound of one reset command; a longer chapter offers no reset. */
const MAX_RESET_LESSONS = 100;

/** Состояние сброса, которое видит читатель. */
export type ChapterProgressResetState =
  | { readonly kind: "offer" }
  | { readonly kind: "confirm"; readonly status: "idle" | "pending" | "failed" }
  | { readonly kind: "done" };

function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

/**
 * Сброс прогресса главы стоит после уроков, а не рядом с листанием глав
 * (docs/specifications/platform-v1.md, окно главы). Подтверждение
 * на месте: окно главы уже диалог, второе окно поверх него не открывается. `moved` значит, что шаг
 * сменил читатель: тогда фокус идёт к «Отмене» при вопросе, к кнопке после отказа и к итогу, когда
 * кнопки больше нет. Первый показ фокус не трогает.
 */
export function ChapterProgressResetView({
  state,
  read,
  moved,
  onOffer,
  onConfirm,
  onCancel,
}: {
  readonly state: ChapterProgressResetState;
  /** Изученные уроки главы: столько отметок снимет сброс. */
  readonly read: number;
  readonly moved: boolean;
  readonly onOffer: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const focus = moved ? focusOnMount : undefined;
  if (state.kind === "done")
    return (
      <div className={styles["reset"]} data-chapter-reset="done">
        <p className={styles["note"]} ref={focus} role="status" tabIndex={-1}>
          Прогресс главы сброшен. Можно проходить её заново.
        </p>
      </div>
    );
  if (state.kind === "offer")
    return (
      <div className={styles["reset"]} data-chapter-reset="offer">
        <Button
          className={styles["offer"]}
          onClick={onOffer}
          ref={focus}
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" />
          Сбросить прогресс главы
        </Button>
      </div>
    );
  const pending = state.status === "pending";
  return (
    <div
      aria-busy={pending}
      aria-label="Сброс прогресса главы"
      className={styles["reset"]}
      data-chapter-reset="confirm"
      role="group"
    >
      <p className={styles["question"]}>
        {`Снять отметку «изучено» с ${formatLessonsGenitive(read)} и начать главу заново?`}
      </p>
      {state.status === "failed" ? (
        <p className={styles["error"]} role="alert">
          Не получилось сбросить прогресс. Попробуй ещё раз.
        </p>
      ) : null}
      <div className={styles["actions"]}>
        <Button
          aria-disabled={pending}
          onClick={pending ? undefined : onConfirm}
          variant="destructive"
        >
          {pending
            ? "Сбрасываем…"
            : state.status === "failed"
              ? "Повторить"
              : "Сбросить"}
        </Button>
        {/* Stays enabled while saving, so the focus it holds is not dropped to the page. */}
        <Button
          aria-disabled={pending}
          onClick={pending ? undefined : onCancel}
          ref={focus}
          variant="ghost"
        >
          Отмена
        </Button>
      </div>
    </div>
  );
}

/** Сброс прогресса одной главы; виден только вошедшему читателю с изученными уроками в ней. */
export function ChapterProgressReset({
  materialIds,
}: {
  readonly materialIds: readonly string[];
}) {
  const { connect, missing, read, signedIn } = useChapterReading(materialIds);
  // Once the reader has asked, the control stays to show its question and result, although the
  // chapter may have no studied lessons left.
  const [asked, setAsked] = useState(false);
  const [moved, setMoved] = useState(false);
  const visible =
    signedIn &&
    !missing &&
    new Set(materialIds).size <= MAX_RESET_LESSONS &&
    (read > 0 || asked);
  return (
    <div ref={connect}>
      {visible ? (
        <ResetControl
          asked={asked}
          materialIds={materialIds}
          moved={moved}
          onAskedChange={(next) => {
            setAsked(next);
            setMoved(true);
          }}
          read={read}
        />
      ) : null}
    </div>
  );
}

/** Mounted only when shown, so a guest's or a loading window holds no reset mutation. */
function ResetControl({
  asked,
  materialIds,
  moved,
  read,
  onAskedChange,
}: {
  readonly asked: boolean;
  readonly materialIds: readonly string[];
  readonly moved: boolean;
  readonly read: number;
  readonly onAskedChange: (asked: boolean) => void;
}) {
  const { status, reset } = useProgressReset(materialIds);
  return (
    <ChapterProgressResetView
      moved={moved}
      onCancel={() => {
        onAskedChange(false);
      }}
      onConfirm={reset}
      onOffer={() => {
        onAskedChange(true);
      }}
      read={read}
      state={resetState(asked, status)}
    />
  );
}

function resetState(
  asked: boolean,
  status: ProgressResetStatus,
): ChapterProgressResetState {
  if (status === "done") return { kind: "done" };
  if (status === "pending" || status === "failed")
    return { kind: "confirm", status };
  return asked ? { kind: "confirm", status: "idle" } : { kind: "offer" };
}
