"use client";

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import {
  useCallback,
  useId,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

import type { GlossaryTerm } from "@/entities/material.model";
import { cn } from "@/shared/lib/utils";
import { createTermDeckTrack } from "../lib/term-deck-track.browser";

export interface LessonTermDeckProps {
  readonly terms: readonly GlossaryTerm[];
}

const arrowButton =
  "inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--motion-duration-fast) hover:bg-lesson-stack hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-35 disabled:hover:bg-transparent motion-reduce:transition-none";

/**
 * «Термины урока»: свой блок в конце урока перед карточкой «Финиш урока», всегда открытый
 * (решения владельца 14.11.2026). Карусель карточек по образцу WAI-ARIA Carousel: свайп, мышь
 * (нажать и тянуть), стрелки или клавиши ← и →; следующая карточка выглядывает справа. Нажатие,
 * Enter или пробел переворачивают карточку: термин на лицевой стороне, короткое определение на
 * обороте. Отметок, счётчиков и состояния «пройдено» нет. В порядке Tab стоит только текущая
 * карточка.
 */
export function LessonTermDeck({ terms }: LessonTermDeckProps) {
  const headingId = useId();
  const [track] = useState(createTermDeckTrack);
  const position = useSyncExternalStore(
    track.subscribe,
    track.getSnapshot,
    track.getServerSnapshot,
  );
  const connect = useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      return track.connect(element);
    },
    [track],
  );
  const [cards, setCards] = useState<{
    readonly turned: ReadonlySet<string>;
    readonly lastFlip: {
      readonly termId: string;
      readonly turned: boolean;
      readonly selectionRevision: number;
    } | null;
  }>(() => ({ turned: new Set(), lastFlip: null }));
  const selected = terms[position.index];
  const lastFlip = cards.lastFlip;
  const flippedTerm = terms.find((term) => term.id === lastFlip?.termId);
  const announcement =
    position.selectionRevision > (lastFlip?.selectionRevision ?? 0)
      ? selected === undefined
        ? ""
        : `${selected.title}, ${String(position.index + 1)} из ${String(terms.length)}`
      : lastFlip === null || flippedTerm === undefined
        ? ""
        : lastFlip.turned
          ? flippedTerm.shortDefinition
          : flippedTerm.title;

  if (terms.length === 0) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") track.goTo(position.index + 1, true);
    else if (event.key === "ArrowLeft") track.goTo(position.index - 1, true);
    else if (event.key === "Home") track.goTo(0, true);
    else if (event.key === "End") track.goTo(terms.length - 1, true);
    else return;
    event.preventDefault();
  };

  const flip = (term: GlossaryTerm) => {
    const selectionRevision = track.getSnapshot().selectionRevision;
    setCards((previous) => {
      const turned = new Set(previous.turned);
      const showing = !turned.has(term.id);
      if (showing) turned.add(term.id);
      else turned.delete(term.id);
      return {
        turned,
        lastFlip: { termId: term.id, turned: showing, selectionRevision },
      };
    });
  };

  return (
    <section
      aria-labelledby={headingId}
      aria-roledescription="карусель"
      className="mt-12 rounded-2xl bg-lesson-surface pt-3 sm:pt-4"
      data-lesson-term-deck
    >
      <div className="flex min-h-11 items-center justify-between gap-2 px-4 sm:px-6">
        <h2
          className="text-sm font-medium text-muted-foreground"
          id={headingId}
        >
          Термины урока
        </h2>
        {position.scrollable ? (
          <div className="-my-1 -mr-2 flex items-center">
            <button
              aria-label="Предыдущий термин"
              className={arrowButton}
              disabled={position.index === 0}
              onClick={() => {
                track.goTo(position.index - 1, false);
              }}
              type="button"
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <button
              aria-label="Следующий термин"
              className={arrowButton}
              disabled={position.index === terms.length - 1}
              onClick={() => {
                track.goTo(position.index + 1, false);
              }}
              type="button"
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          </div>
        ) : null}
      </div>
      <div
        className="lesson-term-track relative flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pt-2 pb-6 select-none sm:scroll-px-6 sm:px-6 [scrollbar-width:none] motion-safe:scroll-smooth data-dragging:cursor-grabbing data-dragging:snap-none data-dragging:scroll-auto [&::-webkit-scrollbar]:hidden"
        data-lesson-term-track
        onKeyDown={onKeyDown}
        ref={connect}
      >
        {terms.map((term, place) => {
          const isTurned = cards.turned.has(term.id);
          return (
            <div
              aria-label={`${String(place + 1)} из ${String(terms.length)}`}
              aria-roledescription="слайд"
              className="w-[calc(100%-2.75rem)] max-w-sm shrink-0 snap-start"
              data-lesson-term-slide
              key={term.id}
              role="group"
            >
              <button
                className="block w-full cursor-pointer rounded-2xl text-left perspective-[1400px] transition-transform duration-(--motion-duration-fast) ease-(--motion-ease-out) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 [@media(hover:hover)]:hover:-translate-y-0.5"
                data-lesson-term-card={term.id}
                data-lesson-term-side={isTurned ? "back" : "front"}
                draggable={false}
                onClick={() => {
                  flip(term);
                }}
                tabIndex={place === position.index ? 0 : -1}
                type="button"
              >
                <TermCardFaces
                  hint={cards.lastFlip === null && place === 0}
                  term={term}
                  turned={isTurned}
                />
              </button>
            </div>
          );
        })}
      </div>
      <p aria-live="polite" className="sr-only" data-lesson-term-announcement>
        {announcement}
      </p>
    </section>
  );
}

/**
 * Both sides of a card in one place; the hidden side is turned away and out of the reading order.
 * The front is a light card and the back is sand, so the turn shows. A quiet turn glyph sits in
 * the corner of both sides; the front also says what a press does.
 */
function TermCardFaces({
  term,
  turned,
  hint,
}: {
  readonly term: GlossaryTerm;
  readonly turned: boolean;
  readonly hint: boolean;
}) {
  const face =
    "relative col-start-1 row-start-1 flex min-h-44 flex-col justify-center rounded-2xl px-5 pt-6 pb-10 backface-hidden";
  const glyph = "absolute right-4 bottom-4 size-4";
  return (
    <div
      className={cn(
        "relative grid transform-3d transition-transform duration-500 ease-(--motion-ease-out) motion-reduce:transition-none",
        turned && "rotate-y-180",
        hint && !turned && "lesson-term-flip-hint",
      )}
    >
      <div
        aria-hidden={turned}
        className={`${face} bg-card text-foreground shadow-card`}
        data-lesson-term-face="front"
      >
        <p className="text-xl font-semibold tracking-[-0.02em] text-balance">
          {term.title}
        </p>
        {term.englishTitle === null ? null : (
          <p className="mt-1 text-sm text-muted-foreground">
            {term.englishTitle}
          </p>
        )}
        <p
          aria-hidden="true"
          className="absolute bottom-3.5 left-5 text-xs text-muted-foreground"
        >
          Нажмите, чтобы увидеть определение
        </p>
        <RefreshCw
          aria-hidden="true"
          className={`${glyph} text-muted-foreground`}
        />
      </div>
      <div
        aria-hidden={!turned}
        className={`${face} rotate-y-180 bg-lesson-sand text-foreground shadow-card`}
        data-lesson-term-face="back"
      >
        <p className="text-base leading-7 text-pretty">
          {term.shortDefinition}
        </p>
        <RefreshCw aria-hidden="true" className={`${glyph} text-lesson-ink`} />
      </div>
    </div>
  );
}
