"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useId, useState } from "react";

import type { GlossaryTerm } from "@/entities/material.model";
import { Button } from "@/shared/ui/button";
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

/**
 * Колода «Термины урока» в конце урока: термин на лицевой стороне, короткое определение на
 * обороте. Отметки «знаю» и «повторить» вошедший сохраняет за собой; после отметки колода
 * переходит к следующему термину.
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
      className="mt-10 rounded-2xl border border-border bg-card p-4 sm:p-6"
      data-lesson-term-deck
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold" id={headingId}>
          Термины урока
        </h2>
        <p
          className="text-sm text-muted-foreground tabular-nums"
          data-lesson-term-position
        >
          {position + 1} из {terms.length}
        </p>
      </div>

      <div
        className="mt-4 flex min-h-44 flex-col justify-center rounded-xl border border-border bg-background p-4 text-center sm:p-6"
        data-lesson-term-card={term.id}
        data-lesson-term-side={turned ? "back" : "front"}
      >
        {turned ? (
          <p className="text-base leading-7" aria-live="polite">
            {term.shortDefinition}
          </p>
        ) : (
          <p className="text-xl font-semibold text-balance">
            {term.title}
            {term.englishTitle === null ? null : (
              <span className="mt-1 block text-sm font-normal text-muted-foreground">
                {term.englishTitle}
              </span>
            )}
          </p>
        )}
        <div className="mt-4">
          <Button
            className="min-h-11"
            onClick={() => {
              setTurned((value) => !value);
            }}
            type="button"
            variant="outline"
          >
            {turned ? "Показать термин" : "Показать определение"}
          </Button>
        </div>
      </div>

      {marking.kind === "ready" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(["known", "review"] as const).map((mark) => (
            <Button
              aria-pressed={current === mark}
              className={cn(
                "min-h-11 flex-1 sm:flex-none",
                current === mark && "ring-2 ring-ring/50",
              )}
              data-lesson-term-mark={mark}
              disabled={marking.savingTermId !== null}
              key={mark}
              onClick={() => {
                onMark?.(term.id, mark);
                if (position + 1 < terms.length) go(position + 1);
              }}
              type="button"
              variant={current === mark ? "default" : "outline"}
            >
              {markLabels[mark]}
            </Button>
          ))}
          <p className="w-full text-sm text-muted-foreground" role="status">
            {marking.failed
              ? "Не удалось сохранить отметку. Попробуйте ещё раз."
              : `Знаю: ${String(known)}, повторить: ${String(review)}`}
          </p>
        </div>
      ) : marking.kind === "guest" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          <Link
            className="text-foreground underline underline-offset-4"
            href={marking.loginHref}
          >
            Войдите
          </Link>
          , чтобы отмечать термины «знаю» и «повторить».
        </p>
      ) : marking.kind === "unavailable" ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Отметки сейчас недоступны.
        </p>
      ) : null}

      <nav
        aria-label="Карточки терминов"
        className="mt-4 flex items-center justify-between gap-2"
      >
        <Button
          aria-label="Предыдущий термин"
          className="min-h-11 min-w-11"
          disabled={position === 0}
          onClick={() => {
            go(position - 1);
          }}
          type="button"
          variant="ghost"
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        {courseGlossaryHref === undefined ? null : (
          <Link
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
            href={courseGlossaryHref}
          >
            Все термины курса
          </Link>
        )}
        <Button
          aria-label="Следующий термин"
          className="min-h-11 min-w-11"
          disabled={position + 1 >= terms.length}
          onClick={() => {
            go(position + 1);
          }}
          type="button"
          variant="ghost"
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </nav>
    </section>
  );
}
