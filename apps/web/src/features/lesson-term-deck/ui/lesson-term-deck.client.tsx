"use client";

import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
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
}

const arrowButton =
  "inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-(--motion-duration-fast) hover:bg-lesson-stack hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-35 disabled:hover:bg-transparent motion-reduce:transition-none";

/** A mouse press that travels this far is a drag, not a click. */
const DRAG_THRESHOLD = 6;
/** A drag this long moves to the neighbouring card even when it stops short of the middle. */
const DRAG_FLICK = 40;

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
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [turned, setTurned] = useState<ReadonlySet<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState("");
  // The first card hints once that it turns over, until the reader turns any card.
  const [hint, setHint] = useState(true);
  // Arrows appear only when the cards do not all fit: a wide lesson column may show every term.
  const [scrollable, setScrollable] = useState(false);
  const indexRef = useRef(0);
  // The card an arrow, a key or a drag asked for; the scroll position catches up smoothly.
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

  const go = useCallback(
    (place: number, focus: boolean) => {
      const track = trackRef.current;
      if (track === null) return;
      const all = slides(track);
      const target = Math.max(0, Math.min(all.length - 1, place));
      const slide = all[target];
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
      if (focus)
        slide
          .querySelector<HTMLElement>("[data-lesson-term-card]")
          ?.focus({ preventScroll: true });
    },
    [show],
  );

  // The visible card follows the scroll position, whatever moved it: a swipe, a wheel, an arrow.
  // A mouse drags the track like a finger; a press without travel stays a click on the card.
  useEffect(() => {
    const track = trackRef.current;
    if (track === null) return;
    let frame = 0;
    // The edge where more cards wait fades into the sand; the start and the end stay sharp.
    const edges = () => {
      const more = track.scrollWidth - track.clientWidth;
      if (track.scrollLeft > 1) track.dataset["moreBefore"] = "";
      else delete track.dataset["moreBefore"];
      if (more > 1 && track.scrollLeft < more - 1)
        track.dataset["moreAfter"] = "";
      else delete track.dataset["moreAfter"];
    };
    const settle = () => {
      frame = 0;
      edges();
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

    let drag: {
      readonly pointerId: number;
      readonly startX: number;
      readonly startLeft: number;
      readonly startIndex: number;
      moved: boolean;
    } | null = null;
    let swallowClick = false;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      pendingRef.current = null;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startLeft: track.scrollLeft,
        startIndex: indexRef.current,
        moved: false,
      };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      const travel = event.clientX - drag.startX;
      if (!drag.moved) {
        if (Math.abs(travel) < DRAG_THRESHOLD) return;
        drag.moved = true;
        track.dataset["dragging"] = "";
        try {
          track.setPointerCapture(event.pointerId);
        } catch {
          // A synthetic pointer cannot be captured; the drag still follows it over the track.
        }
      }
      event.preventDefault();
      track.scrollLeft = drag.startLeft - travel;
    };
    const onPointerEnd = (event: PointerEvent) => {
      if (drag === null || event.pointerId !== drag.pointerId) return;
      const { moved, startIndex, startX } = drag;
      drag = null;
      if (!moved) return;
      delete track.dataset["dragging"];
      // The click that ends a drag must not turn the card under the pointer.
      swallowClick = true;
      setTimeout(() => {
        swallowClick = false;
      }, 0);
      const travel = event.clientX - startX;
      let target = visibleSlide(track);
      if (target === startIndex && Math.abs(travel) >= DRAG_FLICK)
        target += travel < 0 ? 1 : -1;
      go(target, false);
    };
    const onClickCapture = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    track.addEventListener("scroll", onScroll, { passive: true });
    track.addEventListener("wheel", takeOver, { passive: true });
    track.addEventListener("touchstart", takeOver, { passive: true });
    track.addEventListener("pointerdown", onPointerDown);
    track.addEventListener("pointermove", onPointerMove);
    track.addEventListener("pointerup", onPointerEnd);
    track.addEventListener("pointercancel", onPointerEnd);
    track.addEventListener("click", onClickCapture, true);
    const measure = () => {
      edges();
      setScrollable(track.scrollWidth > track.clientWidth + 1);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(track);
    return () => {
      track.removeEventListener("scroll", onScroll);
      track.removeEventListener("wheel", takeOver);
      track.removeEventListener("touchstart", takeOver);
      track.removeEventListener("pointerdown", onPointerDown);
      track.removeEventListener("pointermove", onPointerMove);
      track.removeEventListener("pointerup", onPointerEnd);
      track.removeEventListener("pointercancel", onPointerEnd);
      track.removeEventListener("click", onClickCapture, true);
      resize.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [go, show]);

  if (terms.length === 0) return null;

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
    setHint(false);
    setAnnouncement(showing ? term.shortDefinition : term.title);
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
        {scrollable ? (
          <div className="-my-1 -mr-2 flex items-center">
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
      <div
        className="lesson-term-track relative flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pt-2 pb-6 select-none sm:scroll-px-6 sm:px-6 [scrollbar-width:none] motion-safe:scroll-smooth data-dragging:cursor-grabbing data-dragging:snap-none data-dragging:scroll-auto [&::-webkit-scrollbar]:hidden"
        data-lesson-term-track
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
                className="block w-full cursor-pointer rounded-2xl text-left perspective-[1400px] transition-transform duration-(--motion-duration-fast) ease-(--motion-ease-out) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 [@media(hover:hover)]:hover:-translate-y-0.5"
                data-lesson-term-card={term.id}
                data-lesson-term-side={isTurned ? "back" : "front"}
                draggable={false}
                onClick={() => {
                  flip(term);
                }}
                tabIndex={place === index ? 0 : -1}
                type="button"
              >
                <TermCardFaces
                  hint={hint && place === 0}
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

/**
 * Both sides of a card in one place; the hidden side is turned away and out of the reading order.
 * A quiet turn glyph sits in the corner of both sides; the front also says what a press does.
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
      >
        <p className="text-base leading-7 text-pretty">
          {term.shortDefinition}
        </p>
        <RefreshCw aria-hidden="true" className={`${glyph} text-lesson-ink`} />
      </div>
    </div>
  );
}
