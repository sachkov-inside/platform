"use client";

import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  useProgressReset,
  type ProgressResetStatus,
} from "@/features/reading-progress";
import { Button } from "@/shared/ui/button";

import { useChapterReading } from "./chapter-reading-progress.client";
import styles from "./chapter-progress-reset.module.css";

/** Состояние сброса, которое видит читатель. */
export type ChapterProgressResetState =
  | { readonly kind: "offer" }
  | { readonly kind: "confirm"; readonly status: "idle" | "pending" | "failed" }
  | { readonly kind: "done" };

/**
 * Сброс прогресса главы в конце окна главы (решение владельца 24.11.2026). Редкое действие стоит
 * после уроков, а не рядом с листанием глав. Подтверждение на месте: окно главы уже диалог, второе
 * окно поверх него не открывается.
 */
export function ChapterProgressResetView({
  state,
  read,
  onOffer,
  onConfirm,
  onCancel,
}: {
  readonly state: ChapterProgressResetState;
  /** Изученные уроки главы: столько отметок снимет сброс. */
  readonly read: number;
  readonly onOffer: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const offerRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  const previous = useRef(state.kind);
  // Фокус идёт за сменой шага: к «Отмене» при вопросе, обратно к кнопке при отказе и к итогу,
  // когда кнопки больше нет. Первый показ фокус не трогает.
  useEffect(() => {
    if (previous.current === state.kind) return;
    previous.current = state.kind;
    if (state.kind === "confirm") cancelRef.current?.focus();
    else if (state.kind === "offer") offerRef.current?.focus();
    else doneRef.current?.focus();
  }, [state.kind]);

  if (state.kind === "done")
    return (
      <div className={styles["reset"]} data-chapter-reset="done">
        <p className={styles["note"]} ref={doneRef} role="status" tabIndex={-1}>
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
          ref={offerRef}
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
      className={styles["reset"]}
      data-chapter-reset="confirm"
      role="group"
      aria-label="Сброс прогресса главы"
    >
      <p className={styles["question"]}>
        {`Снять отметку «изучено» с ${String(read)} ${read % 10 === 1 && read % 100 !== 11 ? "урока" : "уроков"} и начать главу заново?`}
      </p>
      {state.status === "failed" ? (
        <p className={styles["error"]} role="alert">
          Не получилось сбросить прогресс. Попробуй ещё раз.
        </p>
      ) : null}
      <div className={styles["actions"]}>
        <Button disabled={pending} onClick={onConfirm} variant="destructive">
          {pending
            ? "Сбрасываем…"
            : state.status === "failed"
              ? "Повторить"
              : "Сбросить"}
        </Button>
        <Button
          disabled={pending}
          onClick={onCancel}
          ref={cancelRef}
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
  // Once the reader has started a reset, the control stays to show its question and result,
  // although the chapter has no studied lessons left.
  const [engaged, setEngaged] = useState(false);
  const visible = signedIn && !missing && (read > 0 || engaged);
  return (
    <div ref={connect}>
      {visible ? (
        <ResetControl
          materialIds={materialIds}
          onEngage={setEngaged}
          read={read}
        />
      ) : null}
    </div>
  );
}

function ResetControl({
  materialIds,
  read,
  onEngage,
}: {
  readonly materialIds: readonly string[];
  readonly read: number;
  readonly onEngage: (engaged: boolean) => void;
}) {
  const { status, reset } = useProgressReset(materialIds);
  const [asked, setAsked] = useState(false);
  return (
    <ChapterProgressResetView
      onCancel={() => {
        setAsked(false);
        onEngage(false);
      }}
      onConfirm={reset}
      onOffer={() => {
        setAsked(true);
        onEngage(true);
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
