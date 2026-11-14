"use client";

import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { GlossaryTerm } from "@/entities/material.model";
import { cn } from "@/shared/lib/utils";

export interface LessonTermDeckProps {
  readonly terms: readonly GlossaryTerm[];
  /** Страница словаря курса; вне курса её нет. */
  readonly courseGlossaryHref?: Route | undefined;
}

const arrowButton =
  "inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--motion-duration-fast) hover:bg-lesson-stack hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-35 disabled:hover:bg-transparent motion-reduce:transition-none";

/**
 * «Термины урока · N» в карточке конца урока: одна строка, которая раскрывает карусель на месте
 * (решение владельца 14.11.2026). Карточки листаются свайпом, стрелками или клавишами ← и →;
 * следующая карточка выглядывает справа. Нажатие, Enter или пробел переворачивают карточку:
 * термин на лицевой стороне, короткое определение на обороте. Отметок, счётчиков и состояния
 * «пройдено» нет.
 */
export function LessonTermDeck({
  terms,
  courseGlossaryHref,
}: LessonTermDeckProps) {
  const deckId = useId();
  const [expanded, setExpanded] = useState(false);
  if (terms.length === 0) return null;
  return (
    <div data-lesson-term-deck>
      <button
        aria-controls={deckId}
        aria-expanded={expanded}
        className="flex min-h-12 w-full items-center justify-between gap-4 rounded-lg py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={() => {
          setExpanded((value) => !value);
        }}
        type="button"
      >
        <span>
          {"Термины урока "}
          <span className="text-muted-foreground tabular-nums">
            · {terms.length}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-5 shrink-0 text-muted-foreground transition-transform duration-(--motion-duration-fast) motion-reduce:transition-none",
            expanded && "rotate-180",
          )}
        />
      </button>
      <div className="pt-1 pb-3" hidden={!expanded} id={deckId}>
        {expanded ? (
          <TermCarousel courseGlossaryHref={courseGlossaryHref} terms={terms} />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Карусель по образцу WAI-ARIA Carousel: область с ролью «карусель», каждая карточка — слайд;
 * в порядке Tab стоит только текущая карточка, ← и → переводят фокус к соседней.
 */
function TermCarousel({
  terms,
  courseGlossaryHref,
}: {
  readonly terms: readonly GlossaryTerm[];
  readonly courseGlossaryHref: Route | undefined;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [turned, setTurned] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  // Arrows appear only when the cards do not all fit: a wide finish card may show every term.
  const [scrollable, setScrollable] = useState(false);
  const indexRef = useRef(0);
  // The card an arrow or a key asked for; the scroll position catches up with it smoothly.
  const pendingRef = useRef<number | null>(null);

  const show = useCallback(
    (place: number) => {
      if (place === indexRef.current) return;
      indexRef.current = place;
      setIndex(place);
      const term = terms[place];
      if (term !== undefined)
        setAnnouncement(
          `${term.title}, ${String(place + 1)} из ${String(terms.length)}`,
        );
    },
    [terms],
  );

  const cardAt = useCallback((place: number) => {
    return (
      trackRef.current?.querySelectorAll<HTMLElement>(
        "[data-lesson-term-card]",
      )[place] ?? null
    );
  }, []);

  // The visible card follows the scroll position, whatever moved it: a swipe, a wheel, an arrow.
  useEffect(() => {
    const track = trackRef.current;
    if (track === null) return;
    let frame = 0;
    const settle = () => {
      frame = 0;
      const nearest = visibleSlide(track);
      if (pendingRef.current !== null) {
        if (nearest !== pendingRef.current) return;
        pendingRef.current = null;
      }
      show(nearest);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(settle);
    };
    // A reader's own swipe or wheel takes over from a scroll an arrow started.
    const takeOver = () => {
      pendingRef.current = null;
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("pointerdown", takeOver, { passive: true });
    track.addEventListener("wheel", takeOver, { passive: true });
    const measure = () => {
      setScrollable(track.scrollWidth > track.clientWidth + 1);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(track);
    return () => {
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("pointerdown", takeOver);
      track.removeEventListener("wheel", takeOver);
      resize.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [show]);

  const go = (place: number, focus: boolean) => {
    const target = Math.max(0, Math.min(terms.length - 1, place));
    const track = trackRef.current;
    if (track === null) return;
    const slide = slides(track)[target];
    if (slide === undefined) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    pendingRef.current = target;
    show(target);
    track.scrollTo({
      left: slideScrollLeft(track, slide),
      behavior: reduced ? "auto" : "smooth",
    });
    if (focus) cardAt(target)?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") go(indexRef.current + 1, true);
    else if (event.key === "ArrowLeft") go(indexRef.current - 1, true);
    else if (event.key === "Home") go(0, true);
    else if (event.key === "End") go(terms.length - 1, true);
    else return;
    event.preventDefault();
  };

  const flip = (term: GlossaryTerm) => {
    const next = new Set(turned);
    const showing = !next.has(term.id);
    if (showing) next.add(term.id);
    else next.delete(term.id);
    setTurned(next);
    setAnnouncement(showing ? term.shortDefinition : term.title);
  };

  return (
    <section
      aria-label="Термины урока"
      aria-roledescription="карусель"
      data-lesson-term-carousel
    >
      <div
        className="relative flex snap-x snap-mandatory scroll-px-1 gap-3 overflow-x-auto px-1 overscroll-x-contain pt-2 pb-5 [scrollbar-width:none] motion-safe:scroll-smooth [&::-webkit-scrollbar]:hidden"
        onKeyDown={onKeyDown}
        ref={trackRef}
      >
        {terms.map((term, place) => {
          const isTurned = turned.has(term.id);
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
                className="block w-full rounded-2xl text-left perspective-[1400px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                data-lesson-term-card={term.id}
                data-lesson-term-side={isTurned ? "back" : "front"}
                onClick={() => {
                  flip(term);
                }}
                tabIndex={place === index ? 0 : -1}
                type="button"
              >
                <TermCardFaces term={term} turned={isTurned} />
              </button>
            </div>
          );
        })}
      </div>
      <p aria-live="polite" className="sr-only" data-lesson-term-announcement>
        {announcement}
      </p>
      {courseGlossaryHref === undefined && !scrollable ? null : (
        <div className="flex min-h-11 items-center justify-between gap-2">
          {courseGlossaryHref === undefined ? (
            <span />
          ) : (
            <Link
              className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline decoration-lesson-line underline-offset-4 transition-colors duration-(--motion-duration-fast) hover:text-foreground hover:decoration-current motion-reduce:transition-none"
              href={courseGlossaryHref}
            >
              Все термины курса
            </Link>
          )}
          {scrollable ? (
            <div className="flex items-center">
              <button
                aria-label="Предыдущий термин"
                className={arrowButton}
                disabled={index === 0}
                onClick={() => {
                  go(index - 1, false);
                }}
                type="button"
              >
                <ChevronLeft aria-hidden="true" className="size-5" />
              </button>
              <button
                aria-label="Следующий термин"
                className={arrowButton}
                disabled={index === terms.length - 1}
                onClick={() => {
                  go(index + 1, false);
                }}
                type="button"
              >
                <ChevronRight aria-hidden="true" className="size-5" />
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function slides(track: HTMLElement): HTMLElement[] {
  return [...track.querySelectorAll<HTMLElement>("[data-lesson-term-slide]")];
}

/** Where the track scrolls to bring `slide` to its start edge. */
function slideScrollLeft(track: HTMLElement, slide: HTMLElement): number {
  const first = slides(track)[0];
  return slide.offsetLeft - (first?.offsetLeft ?? 0);
}

/**
 * The slide at the start edge. A track scrolled to its end shows the last slide, even when it
 * cannot reach the start edge because the slides before it are narrower than the track.
 */
function visibleSlide(track: HTMLElement): number {
  const all = slides(track);
  if (track.scrollWidth <= track.clientWidth + 1) return 0;
  if (track.scrollLeft >= track.scrollWidth - track.clientWidth - 1)
    return Math.max(0, all.length - 1);
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  all.forEach((slide, place) => {
    const gap = Math.abs(slideScrollLeft(track, slide) - track.scrollLeft);
    if (gap < distance) {
      distance = gap;
      nearest = place;
    }
  });
  return nearest;
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
    "col-start-1 row-start-1 flex min-h-44 flex-col justify-center rounded-2xl px-5 py-6 backface-hidden";
  return (
    <div
      className={cn(
        "relative grid transform-3d transition-transform duration-500 ease-(--motion-ease-out) motion-reduce:transition-none",
        turned && "rotate-y-180",
      )}
    >
      <div
        aria-hidden={turned}
        className={`${face} bg-card text-foreground shadow-card`}
      >
        <p className="text-xl font-semibold tracking-[-0.02em] text-balance">
          {term.title}
        </p>
        {term.englishTitle === null ? null : (
          <p className="mt-1 text-sm text-muted-foreground">
            {term.englishTitle}
          </p>
        )}
      </div>
      <div
        aria-hidden={!turned}
        className={`${face} rotate-y-180 bg-lesson-sand text-foreground shadow-card`}
      >
        <p className="text-base leading-7 text-pretty">
          {term.shortDefinition}
        </p>
      </div>
    </div>
  );
}
