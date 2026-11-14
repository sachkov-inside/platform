"use client";

import { BookOpen, Check, RefreshCw, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useId, useState, type ReactNode } from "react";

import type { GlossaryTerm } from "@/entities/material.model";
import { cn } from "@/shared/lib/utils";

import type { TermMarkValue } from "../model/term-mark-contract";

/**
 * Что колода может сделать с отметками: гость их не сохраняет, вошедший ждёт свои, читает их или
 * не смог их прочитать.
 */
export type LessonTermDeckMarking =
  | { readonly kind: "guest"; readonly loginHref: Route }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "ready";
      readonly marks: ReadonlyMap<string, TermMarkValue>;
      /** Термин, отметка которого сейчас сохраняется. */
      readonly savingTermId: string | null;
      readonly failed: boolean;
    };

export interface LessonTermDeckProps {
  readonly terms: readonly GlossaryTerm[];
  readonly marking: LessonTermDeckMarking;
  readonly onMark?: (termId: string, mark: TermMarkValue) => void;
  /** Страница словаря курса; вне курса её нет. */
  readonly courseGlossaryHref?: Route | undefined;
}

const markLabels: Record<TermMarkValue, string> = {
  known: "Знаю",
  review: "Повторить",
};

const bigButton =
  "flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-medium transition-colors duration-(--motion-duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 motion-reduce:transition-none";
const quietButton = `${bigButton} border border-lesson-line bg-card text-foreground hover:bg-muted`;
const strongButton = `${bigButton} bg-lesson-graphite text-lesson-graphite-foreground hover:bg-lesson-graphite-hover`;
const cardShadow = "shadow-card";

/**
 * Колода «Термины урока» в конце урока: стопка карточек, термин на лицевой стороне, короткое
 * определение на обороте; карточка переворачивается нажатием или с клавиатуры. Вошедший
 * отмечает термин «Знаю» или «Повторить», отметка сохраняется за ним, и колода переходит к
 * следующему термину. Гость листает колоду без отметок.
 */
export function LessonTermDeck({
  terms,
  marking,
  onMark,
  courseGlossaryHref,
}: LessonTermDeckProps) {
  const headingId = useId();
  const [index, setIndex] = useState(0);
  const [turned, setTurned] = useState(false);
  if (terms.length === 0) return null;
  const done = index >= terms.length;
  const position = Math.min(index, terms.length - 1);
  const term = terms[position];
  if (term === undefined) return null;
  const marks: ReadonlyMap<string, TermMarkValue> =
    marking.kind === "ready" ? marking.marks : new Map();
  const known = terms.filter((item) => marks.get(item.id) === "known").length;
  const review = terms.filter((item) => marks.get(item.id) === "review").length;
  const current = marks.get(term.id);
  const go = (next: number) => {
    setIndex(next);
    setTurned(false);
  };

  return (
    <section
      aria-labelledby={headingId}
      className="mt-12 rounded-2xl border border-lesson-line bg-lesson-surface p-4 sm:p-6"
      data-lesson-term-deck
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold" id={headingId}>
          Термины урока
        </h2>
        <p
          className="text-sm text-muted-foreground tabular-nums"
          data-lesson-term-position
        >
          {done ? terms.length : position + 1} из {terms.length}
        </p>
      </div>
      <div aria-hidden="true" className="mt-3 flex gap-1">
        {terms.map((item, place) => (
          <span
            className={cn(
              "h-1 flex-1 rounded-full",
              done || place < position
                ? "bg-lesson-graphite"
                : "bg-lesson-line",
            )}
            key={item.id}
          />
        ))}
      </div>

      <div className="mx-auto mt-5 max-w-md">
        {done ? (
          <div
            className={`flex min-h-60 flex-col items-center justify-center rounded-2xl bg-card px-6 py-8 text-center ${cardShadow}`}
            data-lesson-term-done
          >
            <p className="text-xl font-semibold">Колода пройдена</p>
            {marking.kind === "ready" ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Знаю: {known}, повторить: {review}
              </p>
            ) : null}
            <button
              className={`${quietButton} mt-5 min-h-11`}
              onClick={() => {
                go(0);
              }}
              type="button"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Пройти ещё раз
            </button>
          </div>
        ) : (
          <DeckPile>
            <button
              className="block w-full rounded-2xl text-left perspective-[1400px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
              data-lesson-term-card={term.id}
              data-lesson-term-side={turned ? "back" : "front"}
              onClick={() => {
                setTurned((value) => !value);
              }}
              type="button"
            >
              <TermCardFaces term={term} turned={turned} />
            </button>
          </DeckPile>
        )}
        {/* The turned side is read out once, the way a sighted reader sees it appear. */}
        <p aria-live="polite" className="sr-only">
          {turned && !done ? term.shortDefinition : ""}
        </p>

        {done ? null : marking.kind === "ready" ? (
          <div className="mt-5 grid grid-cols-2 gap-2">
            {(["review", "known"] as const).map((mark) => (
              <button
                aria-pressed={current === mark}
                className={cn(
                  mark === "known" ? strongButton : quietButton,
                  current === mark &&
                    "ring-2 ring-lesson-graphite ring-offset-2 ring-offset-lesson-surface",
                )}
                data-lesson-term-mark={mark}
                disabled={marking.savingTermId !== null}
                key={mark}
                onClick={() => {
                  onMark?.(term.id, mark);
                  go(position + 1);
                }}
                type="button"
              >
                {mark === "known" ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : (
                  <RotateCcw aria-hidden="true" className="size-4" />
                )}
                {markLabels[mark]}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-5">
            <button
              className={`${quietButton} w-full`}
              onClick={() => {
                go(position + 1);
              }}
              type="button"
            >
              Следующий термин
            </button>
          </div>
        )}

        {marking.kind === "ready" ? (
          <p
            className="mt-3 text-center text-sm text-muted-foreground"
            role="status"
          >
            {marking.failed
              ? "Не удалось сохранить отметку. Попробуйте ещё раз."
              : `Знаю: ${String(known)}, повторить: ${String(review)}`}
          </p>
        ) : marking.kind === "guest" ? (
          <p className="mt-3 text-center text-sm text-muted-foreground">
            <Link
              className="text-foreground underline underline-offset-4"
              href={marking.loginHref}
            >
              Войдите
            </Link>
            , чтобы отмечать термины «знаю» и «повторить».
          </p>
        ) : marking.kind === "unavailable" ? (
          <p
            className="mt-3 text-center text-sm text-muted-foreground"
            role="status"
          >
            Отметки сейчас недоступны.
          </p>
        ) : null}
      </div>

      {courseGlossaryHref === undefined ? null : (
        <p className="mt-2 text-center text-sm">
          <Link
            className="inline-flex min-h-11 items-center gap-1.5 text-muted-foreground underline underline-offset-4 hover:text-foreground"
            href={courseGlossaryHref}
          >
            <BookOpen aria-hidden="true" className="size-4" />
            Все термины курса
          </Link>
        </p>
      )}
    </section>
  );
}

/** The card with the rest of the deck under it: two edges peek out below, like a pile of cards. */
function DeckPile({ children }: { readonly children: ReactNode }) {
  return (
    <div className="relative pb-3">
      <div
        aria-hidden="true"
        className="absolute inset-x-6 bottom-0 h-8 rounded-2xl bg-lesson-stack"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-3 bottom-1.5 h-8 rounded-2xl border border-lesson-line bg-card"
      />
      <div className="relative">{children}</div>
    </div>
  );
}

/** Both sides of a card in one place; the hidden side is turned away and out of the reading order. */
function TermCardFaces({
  term,
  turned,
}: {
  readonly term: GlossaryTerm;
  readonly turned: boolean;
}) {
  const face =
    "col-start-1 row-start-1 flex min-h-60 flex-col rounded-2xl px-6 py-8 backface-hidden";
  return (
    <div
      className={cn(
        "relative grid transform-3d transition-transform duration-500 ease-(--motion-ease-out) motion-reduce:transition-none",
        turned && "rotate-y-180",
      )}
    >
      <div
        aria-hidden={turned}
        className={`${face} items-center justify-center bg-card text-center text-foreground ${cardShadow}`}
      >
        <p className="text-2xl font-semibold tracking-[-0.02em] text-balance">
          {term.title}
        </p>
        {term.englishTitle === null ? null : (
          <p className="mt-1 text-sm text-muted-foreground">
            {term.englishTitle}
          </p>
        )}
        <p className="mt-8 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <RefreshCw aria-hidden="true" className="size-3.5" />
          Показать определение
        </p>
      </div>
      <div
        aria-hidden={!turned}
        className={`${face} rotate-y-180 justify-center bg-lesson-sand text-foreground ${cardShadow}`}
      >
        <p className="text-sm font-semibold text-lesson-ink">{term.title}</p>
        <p className="mt-2 text-lg leading-7 text-pretty">
          {term.shortDefinition}
        </p>
        <p className="mt-6 flex items-center gap-1.5 text-xs font-medium text-lesson-ink">
          <RefreshCw aria-hidden="true" className="size-3.5" />
          Показать термин
        </p>
      </div>
    </div>
  );
}
