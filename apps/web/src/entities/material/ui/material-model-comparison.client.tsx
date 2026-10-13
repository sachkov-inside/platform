"use client";

import { useId, useState, type ReactNode } from "react";

export interface MaterialComparisonItem {
  readonly label: string;
  readonly title: string;
  readonly content: ReactNode;
}

/** Presentation-only selection: every panel retains the source's rich content and links. */
export function MaterialModelComparison({
  items,
}: {
  readonly items: readonly MaterialComparisonItem[];
}) {
  const [selected, setSelected] = useState(0);
  const id = useId();

  return (
    <div
      className="mt-8 text-[0.9375rem] leading-[1.6] sm:text-base"
      data-model-comparison
    >
      <div
        aria-label="Выбор модели"
        className="mb-4 flex flex-wrap gap-2"
        role="group"
      >
        {items.map((item, index) => (
          <button
            aria-controls={`${id}-${String(index)}`}
            aria-pressed={selected === index}
            className="min-h-11 rounded-lg border border-[var(--model-comparison-border)] px-3 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-[var(--model-comparison-ink)] aria-pressed:bg-[var(--model-comparison-ink)] aria-pressed:text-[var(--model-comparison-selected-text)]"
            key={item.title}
            onClick={() => {
              setSelected(index);
            }}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <section
          aria-labelledby={`${id}-${String(index)}-heading`}
          className="overflow-hidden rounded-xl border border-[var(--model-comparison-border)] bg-[var(--model-comparison-surface)]"
          hidden={selected !== index}
          id={`${id}-${String(index)}`}
          key={item.title}
        >
          <h3
            data-comparison-heading
            className="border-b border-[var(--model-comparison-border)] px-4 py-4 text-lg font-semibold leading-[1.35] tracking-[-0.02em] sm:px-5 sm:py-5 sm:text-xl"
            id={`${id}-${String(index)}-heading`}
          >
            {item.title}
          </h3>
          <div className="grid gap-4 px-4 pb-4 pt-3 sm:px-5 sm:pb-5 [&>p]:m-0 [&_strong]:mb-1 [&_strong]:block [&_strong]:text-xs [&_strong]:text-[var(--model-comparison-ink)] sm:[&_strong]:text-[0.8125rem]">
            {item.content}
          </div>
        </section>
      ))}
    </div>
  );
}
