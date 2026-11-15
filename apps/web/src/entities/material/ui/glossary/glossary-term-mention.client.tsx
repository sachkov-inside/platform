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
/** Курсор, который просто проходит по тексту, не открывает подсказки одну за другой. */
const HOVER_OPEN_DELAY_MS = 100;
/** Курсор успевает перейти с термина на подсказку, и она не закрывается по дороге. */
const HOVER_CLOSE_DELAY_MS = 150;

type Openness = "closed" | "hover" | "pinned";

const moreClassName =
  "mt-2 min-h-11 font-medium text-lesson-ink underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Первое упоминание термина в уроке: пунктирное подчёркивание, по наведению курсора и по нажатию
 * на телефоне короткое определение и «Подробнее». С `moreHref` (словарь курса показывает термин
 * читателю) «Подробнее» ведёт к его карточке, без него раскрывает полное определение на месте. Подсказка висит
 * поверх текста и не сдвигает его.
 *
 * Место подсказки компонент пишет прямо в её стили до отрисовки кадра, а не через состояние React:
 * так она появляется сразу на своём месте и идёт за словом при прокрутке без отставания.
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
  const arrowRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const [openness, setOpenness] = useState<Openness>("closed");
  const [expanded, setExpanded] = useState(false);
  const open = openness !== "closed";

  const cancelTimers = useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);
  const close = useCallback(() => {
    cancelTimers();
    setOpenness("closed");
    setExpanded(false);
  }, [cancelTimers]);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (trigger === null || bubble === null) return;
    const anchor = trigger.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    const width = Math.min(BUBBLE_MAX_WIDTH, viewport - 2 * VIEWPORT_GUTTER);
    const left = Math.min(
      Math.max(anchor.left, VIEWPORT_GUTTER),
      viewport - VIEWPORT_GUTTER - width,
    );
    // The height is measured at the final width: a narrower or wider bubble wraps differently.
    bubble.style.width = `${String(width)}px`;
    bubble.style.left = `${String(left)}px`;
    const height = bubble.offsetHeight;
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
    const top = side === "top" ? Math.max(above, VIEWPORT_GUTTER) : below;
    bubble.style.top = `${String(top)}px`;
    bubble.setAttribute("data-side", side);
    if (arrowRef.current !== null)
      arrowRef.current.style.left = `${String(arrow)}px`;
    bubble.setAttribute("data-placed", "");
  }, []);

  // The bubble is placed before its first frame is painted, and follows its term while the page
  // or any container around the lesson scrolls: on a desktop the shell's column scrolls, not the
  // window, and a scroll event of an element reaches the document only in the capture phase.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const scrollListener = { capture: true, passive: true } as const;
    document.addEventListener("scroll", place, scrollListener);
    window.addEventListener("resize", place);
    // The bubble's height changes when its content does («Подробнее» expands it in place).
    const resize = new ResizeObserver(place);
    if (bubbleRef.current !== null) resize.observe(bubbleRef.current);
    return () => {
      document.removeEventListener("scroll", place, scrollListener);
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

  useEffect(() => cancelTimers, [cancelTimers]);

  const hoverOpen = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    cancelTimers();
    if (open) return;
    openTimer.current = window.setTimeout(() => {
      setOpenness((current) => (current === "closed" ? "hover" : current));
    }, HOVER_OPEN_DELAY_MS);
  };
  const hoverClose = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(openTimer.current);
    if (openness !== "hover") return;
    window.clearTimeout(closeTimer.current);
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
          cancelTimers();
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
              className="glossary-bubble group invisible fixed top-0 left-0 z-50 rounded-xl border border-border bg-popover p-4 text-left text-sm leading-6 text-popover-foreground shadow-lg data-placed:visible"
              data-glossary-bubble={term.id}
              id={bubbleId}
              onPointerEnter={hoverOpen}
              onPointerLeave={hoverClose}
              ref={bubbleRef}
              role="dialog"
            >
              <span
                aria-hidden="true"
                className="absolute size-3 -translate-x-1/2 rotate-45 border-border bg-popover group-data-[side=bottom]:-top-1.5 group-data-[side=bottom]:border-t group-data-[side=bottom]:border-l group-data-[side=top]:-bottom-1.5 group-data-[side=top]:border-r group-data-[side=top]:border-b"
                data-glossary-arrow=""
                ref={arrowRef}
              />
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
