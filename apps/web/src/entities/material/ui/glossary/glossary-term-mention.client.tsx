"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

import Link from "next/link";

import {
  glossaryDefinitionParagraphs,
  type GlossaryTermReading,
} from "../../model/glossary-term";

import { createGlossaryMention } from "./glossary-mention.browser";

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
  const [
    {
      subscribe,
      getSnapshot,
      getServerSnapshot,
      attachTrigger,
      attachBubble,
      toggleExpanded,
    },
  ] = useState(createGlossaryMention);
  const { openness, expanded } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const open = openness !== "closed";

  return (
    <>
      <button
        aria-controls={open ? bubbleId : undefined}
        aria-expanded={open}
        className="cursor-help rounded-sm text-inherit underline decoration-lesson-ink decoration-dotted decoration-[1.5px] underline-offset-4 [font:inherit] focus-visible:outline-2 focus-visible:outline-ring"
        data-glossary-term={term.id}
        ref={attachTrigger}
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
              ref={attachBubble}
              role="dialog"
            >
              <span
                aria-hidden="true"
                className="absolute size-3 -translate-x-1/2 rotate-45 border-border bg-popover group-data-[side=bottom]:-top-1.5 group-data-[side=bottom]:border-t group-data-[side=bottom]:border-l group-data-[side=top]:-bottom-1.5 group-data-[side=top]:border-r group-data-[side=top]:border-b"
                data-glossary-arrow=""
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
                  onClick={toggleExpanded}
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
