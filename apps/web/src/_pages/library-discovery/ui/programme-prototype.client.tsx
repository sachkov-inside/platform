"use client";

import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ProductChapter } from "@/features/library-discovery";
import type { JourneyRun } from "./series-journey-controls.client";
import "./programme-prototype.css";

/** Throwaway comparison on the real programme route. Never promote the switcher to production. */
const variants = [
  { id: "compact", label: "Компактно" },
  { id: "readiness", label: "По готовности" },
  { id: "original", label: "Как сейчас" },
] as const;
const shortNames = [
  "Подготовка проекта",
  "MVP платформы",
  "Релиз в продакшн",
  "Инфраструктура агентов",
  "Агент внутри продукта",
  "Память и RAG",
  "Безопасность агентов",
  "Качество и эксплуатация",
];

export function ProgrammePrototype({
  enabled,
  chapters,
  runs,
  children,
}: {
  readonly enabled: boolean;
  readonly chapters: readonly ProductChapter[];
  readonly runs: readonly JourneyRun[];
  readonly children: ReactNode;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const [chosen, setChosen] = useState(search.get("variant") ?? "compact");
  const variant = variants.find((item) => item.id === chosen) ?? variants[0];
  const [opened, setOpened] = useState<ReadonlySet<string>>(
    () => new Set(chapters.slice(0, 1).map((item) => item.id)),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const change = useCallback(
    (id: string) => {
      setChosen(id);
      const url = new URL(window.location.href);
      url.searchParams.set("variant", id);
      router.replace(
        `/products/ai-engineering/programme?${url.searchParams.toString()}`,
        { scroll: false },
      );
    },
    [router],
  );
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !(event.target instanceof Element) ||
        event.target.closest(
          'input, textarea, select, button, a, summary, [contenteditable="true"]',
        ) !== null
      )
        return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const index = variants.findIndex((item) => item.id === variant.id);
      change(
        (
          variants[
            (index + (event.key === "ArrowRight" ? 1 : -1) + variants.length) %
              variants.length
          ] ?? variants[0]
        ).id,
      );
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, variant.id, change]);
  if (!enabled) return children;
  const entries = chapters.map((chapter, index) => {
    const chapterRuns = runs.filter((run) => run.chapter?.id === chapter.id);
    const count =
      chapter.materialIds.length +
      (chapter.tasks ?? []).filter(
        (task) => task.programmeVisibility !== "embedded",
      ).length;
    return { chapter, index, runs: chapterRuns, count, preparing: count === 0 };
  });
  const renderContent = (entry: (typeof entries)[number]) => (
    <div className="programme-prototype-content">
      <p className="programme-prototype-full-name">{entry.chapter.name}</p>
      <ChapterCopy summary={entry.chapter.summary} />
      {entry.runs.map((run, index) => (
        <div key={index}>
          {run.leading}
          {run.rows.length === 0 ? null : (
            <ol
              className="programme-prototype-lessons"
              start={run.offset + 1}
              aria-label={`Материалы главы «${entry.chapter.name}»`}
            >
              {run.rows.map((row) => (
                <li key={row.id ?? row.slug}>
                  {row.card}
                  {row.after}
                </li>
              ))}
            </ol>
          )}
          {run.supplementary}
        </div>
      ))}
      {entry.preparing ? (
        <p className="programme-prototype-coming">
          Материалы этой главы появятся по мере развития потока.
        </p>
      ) : null}
    </div>
  );
  const ready = entries.filter((entry) => !entry.preparing);
  const upcoming = entries.filter((entry) => entry.preparing);
  const active = upcoming.find((entry) => entry.chapter.id === selected);
  return (
    <>
      {variant.id === "original" ? (
        children
      ) : (
        <div
          className="programme-prototype"
          data-programme-variant={variant.id}
        >
          <header className="programme-prototype-intro">
            <h2>Программа курса</h2>
            <p>
              Материалы выходят постепенно. Темы всех глав можно посмотреть уже
              сейчас.
            </p>
          </header>
          {variant.id === "compact" ? (
            <div className="programme-prototype-accordion">
              {entries.map((entry) => (
                <details
                  key={entry.chapter.id}
                  open={opened.has(entry.chapter.id)}
                  onToggle={(event) => {
                    const open = event.currentTarget.open;
                    setOpened((previous) => {
                      const next = new Set(previous);
                      if (open) next.add(entry.chapter.id);
                      else next.delete(entry.chapter.id);
                      return next;
                    });
                  }}
                >
                  <summary>
                    <span className="programme-prototype-number">
                      {String(entry.index + 1).padStart(2, "0")}
                    </span>
                    <h3>{shortNames[entry.index] ?? entry.chapter.name}</h3>
                    <span className="programme-prototype-status">
                      {entry.preparing
                        ? "Готовится"
                        : `${String(entry.count)} шагов`}
                    </span>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  {renderContent(entry)}
                </details>
              ))}
            </div>
          ) : (
            <div className="programme-prototype-readiness">
              <section>
                <h3 className="programme-prototype-group-title">
                  Уже в программе <span>{ready.length} главы</span>
                </h3>
                {ready.map((entry) => (
                  <section
                    className="programme-prototype-ready"
                    key={entry.chapter.id}
                  >
                    <h4>
                      <span className="programme-prototype-number">
                        {String(entry.index + 1).padStart(2, "0")}
                      </span>
                      {shortNames[entry.index] ?? entry.chapter.name}
                    </h4>
                    {renderContent(entry)}
                  </section>
                ))}
              </section>
              <section className="programme-prototype-future">
                <h3 className="programme-prototype-group-title">
                  Дальше в программе <span>Материалы готовятся</span>
                </h3>
                <div className="programme-prototype-future-grid">
                  {upcoming.map((entry) => (
                    <button
                      key={entry.chapter.id}
                      type="button"
                      aria-expanded={selected === entry.chapter.id}
                      aria-controls="programme-prototype-future-detail"
                      onClick={() => {
                        setSelected(
                          selected === entry.chapter.id
                            ? null
                            : entry.chapter.id,
                        );
                      }}
                    >
                      <span className="programme-prototype-number">
                        {String(entry.index + 1).padStart(2, "0")}
                      </span>
                      <span>
                        {shortNames[entry.index] ?? entry.chapter.name}
                      </span>
                      <ChevronDown aria-hidden="true" />
                    </button>
                  ))}
                </div>
                <div id="programme-prototype-future-detail">
                  {active === undefined ? null : (
                    <section className="programme-prototype-future-detail">
                      <h4>{shortNames[active.index] ?? active.chapter.name}</h4>
                      {renderContent(active)}
                    </section>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      )}
      <nav
        className="programme-prototype-switcher"
        aria-label="Варианты программы"
      >
        <button
          type="button"
          aria-label="Предыдущий вариант"
          onClick={() => {
            change(
              (
                variants[
                  (variants.indexOf(variant) + variants.length - 1) %
                    variants.length
                ] ?? variants[0]
              ).id,
            );
          }}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <div>
          <span>Сравнение программы</span>
          <div>
            {variants.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={variant.id === item.id}
                onClick={() => {
                  change(item.id);
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          aria-label="Следующий вариант"
          onClick={() => {
            change(
              (
                variants[(variants.indexOf(variant) + 1) % variants.length] ??
                variants[0]
              ).id,
            );
          }}
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </nav>
    </>
  );
}
function ChapterCopy({ summary }: { readonly summary: string }) {
  return (
    <div className="programme-prototype-copy">
      {summary
        .trim()
        .split(/\n\s*\n/u)
        .map((section, index) => {
          const lines = section.split("\n").map((line) => line.trim());
          return lines.every((line) => line.startsWith("- ")) ? (
            <ul key={index}>
              {lines.map((line, i) => (
                <li key={i}>{line.slice(2)}</li>
              ))}
            </ul>
          ) : (
            <p key={index}>{section}</p>
          );
        })}
    </div>
  );
}
