"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import Link from "next/link";

import { cn } from "@/shared/lib/utils";

import {
  glossaryDefinitionParagraphs,
  type GlossaryTermReading,
} from "../../model/glossary-term";

/** Отступ подсказки от края окна: на телефоне 360 px она не выходит за экран. */
const VIEWPORT_GUTTER = 16;
/** Зазор между словом и подсказкой: стрелка занимает его, строка текста остаётся видна. */
const BUBBLE_GAP = 12;
/** Стрелка не подходит к скруглённому углу подсказки ближе этого. */
const ARROW_INSET = 16;
const BUBBLE_MAX_WIDTH = 320;
/** Курсор успевает перейти с термина на подсказку, и она не закрывается по дороге. */
const HOVER_CLOSE_DELAY_MS = 150;

type Openness = "closed" | "hover" | "pinned";

const moreClassName =
  "mt-2 min-h-11 font-medium text-lesson-ink underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

interface BubblePosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  /** Над словом или под ним. */
  readonly side: "top" | "bottom";
  /** Середина стрелки от левого края подсказки. */
  readonly arrow: number;
}

/**
 * Первое упоминание термина в уроке: пунктирное подчёркивание, по наведению курсора и по нажатию
 * на телефоне короткое определение и «Подробнее». С `moreHref` (словарь курса показывает термин
 * читателю) «Подробнее» ведёт к его карточке, без него раскрывает полное определение на месте. Подсказка висит
 * поверх текста и не сдвигает его.
 */
export function GlossaryTermMention({
  children,
  term,
}: {
  readonly children: ReactNode;
  readonly term: GlossaryTermReading;
}) {
  const bubbleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [openness, setOpenness] = useState<Openness>("closed");
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState<BubblePosition | null>(null);
  const open = openness !== "closed";

  const cancelClose = () => {
    window.clearTimeout(closeTimer.current);
  };
  const close = useCallback(() => {
    window.clearTimeout(closeTimer.current);
    setOpenness("closed");
    setExpanded(false);
    setPosition(null);
  }, []);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (trigger === null) return;
    const anchor = trigger.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    const width = Math.min(BUBBLE_MAX_WIDTH, viewport - 2 * VIEWPORT_GUTTER);
    const left = Math.min(
      Math.max(anchor.left, VIEWPORT_GUTTER),
      viewport - VIEWPORT_GUTTER - width,
    );
    const height = bubbleRef.current?.offsetHeight ?? 0;
    // Над словом подсказка закрывает уже прочитанные строки, а не ту, что читатель читает дальше.
    const above = anchor.top - BUBBLE_GAP - height;
    const below = anchor.bottom + BUBBLE_GAP;
    const fitsAbove = above >= VIEWPORT_GUTTER;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_GUTTER;
    const side = fitsAbove || !fitsBelow ? "top" : "bottom";
    // A term that wraps onto two lines points at its first line.
    const firstLine = trigger.getClientRects()[0] ?? anchor;
    const arrow = Math.min(
      Math.max(firstLine.left + firstLine.width / 2 - left, ARROW_INSET),
      width - ARROW_INSET,
    );
    setPosition({
      arrow,
      left,
      side,
      top: side === "top" ? Math.max(above, VIEWPORT_GUTTER) : below,
      width,
    });
  }, []);

  // The bubble is measured after it renders, and follows its term while the page scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    // The bubble's height changes once it takes its width: placing it above needs the final one.
    const resize = new ResizeObserver(place);
    if (bubbleRef.current !== null) resize.observe(bubbleRef.current);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      resize.disconnect();
    };
  }, [open, expanded, place]);

  // An open bubble closes on Escape, returning focus to its term, and on a press outside it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (triggerRef.current?.contains(target) === true ||
          bubbleRef.current?.contains(target) === true)
      )
        return;
      close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, close]);

  useEffect(
    () => () => {
      window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const hoverOpen = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelClose();
    setOpenness((current) => (current === "closed" ? "hover" : current));
  };
  const hoverClose = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || openness !== "hover") return;
    cancelClose();
    closeTimer.current = window.setTimeout(close, HOVER_CLOSE_DELAY_MS);
  };

  return (
    <>
      <button
        aria-controls={open ? bubbleId : undefined}
        aria-expanded={open}
        className="cursor-help rounded-sm text-inherit underline decoration-lesson-ink decoration-dotted decoration-[1.5px] underline-offset-4 [font:inherit] focus-visible:outline-2 focus-visible:outline-ring"
        data-glossary-term={term.id}
        onClick={() => {
          cancelClose();
          if (openness === "pinned") close();
          else setOpenness("pinned");
        }}
        onPointerEnter={hoverOpen}
        onPointerLeave={hoverClose}
        ref={triggerRef}
        type="button"
      >
        {children}
      </button>
      {open
        ? createPortal(
            <div
              aria-label={term.title}
              className="fixed z-50 rounded-xl border border-border bg-popover p-4 text-left text-sm leading-6 text-popover-foreground shadow-lg"
              data-glossary-bubble={term.id}
              data-side={position?.side}
              id={bubbleId}
              onPointerEnter={hoverOpen}
              onPointerLeave={hoverClose}
              ref={bubbleRef}
              role="dialog"
              style={
                position === null
                  ? { left: 0, top: 0, visibility: "hidden" }
                  : {
                      left: position.left,
                      top: position.top,
                      width: position.width,
                    }
              }
            >
              {position === null ? null : (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute size-3 -translate-x-1/2 rotate-45 border-border bg-popover",
                    position.side === "top"
                      ? "-bottom-1.5 border-r border-b"
                      : "-top-1.5 border-t border-l",
                  )}
                  data-glossary-arrow=""
                  style={{ left: position.arrow }}
                />
              )}
              <p className="font-semibold text-foreground">
                {term.title}
                {term.englishTitle === null ? null : (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    ({term.englishTitle})
                  </span>
                )}
              </p>
              <p className="mt-1">{term.shortDefinition}</p>
              {expanded ? (
                <div className="mt-3 border-t border-border pt-3">
                  {glossaryDefinitionParagraphs(term.fullDefinition).map(
                    (paragraph, index) => (
                      <p className="mt-2 first:mt-0" key={index}>
                        {paragraph}
                      </p>
                    ),
                  )}
                </div>
              ) : null}
              {term.moreHref === undefined ? (
                <button
                  aria-expanded={expanded}
                  className={moreClassName}
                  onClick={() => {
                    setOpenness("pinned");
                    setExpanded((current) => !current);
                  }}
                  type="button"
                >
                  {expanded ? "Свернуть" : "Подробнее"}
                </button>
              ) : (
                <Link
                  className={`${moreClassName} inline-flex items-center`}
                  data-glossary-more={term.id}
                  href={term.moreHref}
                >
                  Подробнее
                </Link>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
