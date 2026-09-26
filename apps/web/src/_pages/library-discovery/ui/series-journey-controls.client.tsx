"use client";

import { RefreshCw } from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { SeriesContinuationProvider } from "@/entities/material";
import { formatMaterialCount } from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { readSeriesPage } from "@/shared/routing/material-reader";

import { SERIES_BATCH_SIZE } from "./series-batch";
import { useSeriesLearning } from "./series-learning.client";

/** Строка программы: её карточку нарисовал сервер, здесь только место в списке и возврат к ней. */
export interface JourneyRow {
  readonly available: boolean;
  readonly card: ReactNode;
  readonly ordinal: number;
  readonly returnHref: Route;
  readonly slug: string;
}

/** Непрерывный отрезок части: глава или уроки вне глав. Заголовок главы тоже нарисовал сервер. */
export interface JourneyRun {
  readonly chapter: {
    readonly header: ReactNode;
    readonly id: string;
    readonly name: string;
  } | null;
  readonly offset: number;
  readonly rows: readonly JourneyRow[];
}

export type JourneyPart =
  | {
      readonly chapterCount: number;
      readonly id: "programme" | "supplementary";
      readonly kind: "materials";
      readonly label: string;
      readonly runs: readonly JourneyRun[];
    }
  | {
      readonly count: number;
      readonly id: "artifacts";
      readonly kind: "artifacts";
      readonly label: string;
      readonly panel: ReactNode;
    };

/**
 * Управление программой в браузере: выбор части, порционный показ уроков, возврат к уроку, из
 * которого читатель пришёл, и отметка продолжения. Содержимое строк приходит готовым с сервера.
 */
export function SeriesJourneyControls({
  currentHref,
  offersAccessRecheck,
  parts,
}: {
  readonly currentHref: Route;
  /** Доступ к части уроков не проверился: читателю предлагается перепроверить его. */
  readonly offersAccessRecheck: boolean;
  readonly parts: readonly JourneyPart[];
}) {
  const search = useSearchParams();
  const router = useRouter();
  const learning = useSeriesLearning();
  const requestedPage = readSeriesPage(search.get("page"));
  const requestedMaterial = search.get("at");
  const routeRef = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState(() => ({
    id:
      (
        parts.find((entry) =>
          partRows(entry).some((row) => row.slug === requestedMaterial),
        ) ?? parts[0]
      )?.id ?? "programme",
    // An explicit switch abandons the page in the address, which belongs to the previous part.
    explicit: false,
  }));
  const part = parts.find(({ id }) => id === selection.id) ?? parts[0];
  const visible = part === undefined ? [] : partRows(part);
  const continuation = learning.kind === "ready" ? learning.continuation : null;
  const resumeIndex = visible.findIndex(
    (row) => row.slug === continuation?.materialSlug && row.available,
  );
  const restoredIndex = visible.findIndex(
    (row) => row.slug === requestedMaterial,
  );
  const restoredCount = selection.explicit
    ? 0
    : restoredIndex >= 0
      ? restoredIndex + 1
      : !selection.explicit && search.has("page")
        ? requestedPage * SERIES_BATCH_SIZE
        : resumeIndex + 1;
  const initialCount = Math.min(
    visible.length,
    Math.max(
      SERIES_BATCH_SIZE,
      Math.ceil(restoredCount / SERIES_BATCH_SIZE) * SERIES_BATCH_SIZE,
    ),
  );
  const source = `${part?.id ?? "programme"}:${requestedMaterial ?? ""}:${String(requestedPage)}`;
  const [reveal, setReveal] = useState({ source, count: initialCount });
  if (reveal.source !== source) setReveal({ source, count: initialCount });
  const count = Math.min(
    visible.length,
    Math.max(
      initialCount,
      reveal.source === source ? reveal.count : initialCount,
    ),
  );
  const hasMore = count < visible.length;
  const sentinel = useRef<HTMLDivElement>(null);
  const next = parts
    .flatMap(partRows)
    .find((row) => row.slug === continuation?.materialSlug && row.available);

  useEffect(() => {
    const node = sentinel.current;
    if (
      !hasMore ||
      node === null ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setReveal({
          source,
          count: Math.min(visible.length, count + SERIES_BATCH_SIZE),
        });
      },
      { rootMargin: "0px 0px 240px 0px" },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [count, hasMore, source, visible.length]);

  const returnSlug = selection.explicit
    ? undefined
    : (requestedMaterial ??
      (search.has("page") && requestedPage > 1
        ? visible[(requestedPage - 1) * SERIES_BATCH_SIZE]?.slug
        : undefined));
  useEffect(() => {
    if (returnSlug === undefined) return;
    routeRef.current
      ?.querySelector<HTMLElement>(
        `[data-route-material="${CSS.escape(returnSlug)}"]`,
      )
      ?.scrollIntoView({ block: "center" });
  }, [returnSlug]);

  function selectPart(id: JourneyPart["id"]) {
    if (id === part?.id) return;
    setSelection({ id, explicit: true });
  }

  return (
    <section
      aria-labelledby="series-materials"
      className="mt-5 scroll-mt-6 focus:outline-none"
      ref={routeRef}
      tabIndex={-1}
    >
      <h2 className="sr-only" id="series-materials">
        Материалы продукта
      </h2>
      {parts.length > 1 ? (
        <div
          className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 border-b border-border"
          role="tablist"
          aria-label="Разделы продукта"
        >
          {parts.map((entry) => (
            <button
              aria-controls={`series-part-panel-${entry.id}`}
              aria-selected={entry.id === part?.id}
              className={cn(
                "relative min-h-11 max-w-full py-2 text-sm font-semibold whitespace-normal transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                entry.id === part?.id
                  ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              id={`series-part-${entry.id}`}
              key={entry.id}
              onClick={() => {
                selectPart(entry.id);
              }}
              onKeyDown={(event) => {
                const position = parts.findIndex(({ id }) => id === entry.id);
                const destination =
                  event.key === "ArrowRight"
                    ? (position + 1) % parts.length
                    : event.key === "ArrowLeft"
                      ? (position - 1 + parts.length) % parts.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? parts.length - 1
                          : -1;
                const moved = destination < 0 ? undefined : parts[destination];
                if (moved === undefined) return;
                event.preventDefault();
                selectPart(moved.id);
                requestAnimationFrame(() => {
                  document.getElementById(`series-part-${moved.id}`)?.focus();
                });
              }}
              role="tab"
              tabIndex={entry.id === part?.id ? 0 : -1}
              type="button"
            >
              {entry.label}
              {partCount(entry) > 0 ? (
                <span className="ml-1.5 tabular-nums font-normal text-muted-foreground">
                  {partCount(entry)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {parts.length > 1 ? (
        <p aria-live="polite" className="sr-only">
          {part?.label}:{" "}
          {part?.kind === "artifacts"
            ? artifactsInWords(part.count)
            : formatMaterialCount(visible.length)}
        </p>
      ) : null}
      <div
        aria-labelledby={
          part === undefined ? undefined : `series-part-${part.id}`
        }
        id={`series-part-panel-${part?.id ?? "programme"}`}
        role={parts.length > 1 ? "tabpanel" : undefined}
        tabIndex={parts.length > 1 ? 0 : undefined}
        className="focus-visible:outline-2 focus-visible:outline-ring"
      >
        {part?.kind === "artifacts" ? (
          part.panel
        ) : (
          <>
            {part?.id === "programme" &&
            visible.length === 0 &&
            part.chapterCount === 0 ? (
              <p className="py-10 text-sm leading-6 text-muted-foreground">
                Программа готовится. Здесь появятся главы и уроки продукта.
              </p>
            ) : null}
            {part?.id === "supplementary" && visible.length === 0 ? (
              <p className="py-10 text-sm leading-6 text-muted-foreground">
                Здесь появятся дополнительные разборы и полезные материалы к
                продукту.
              </p>
            ) : null}
            {visible.length > SERIES_BATCH_SIZE ? (
              <p
                aria-live="polite"
                className="mt-6 text-sm tabular-nums text-muted-foreground"
              >
                Показано {count} из {visible.length} материалов
              </p>
            ) : null}
            {offersAccessRecheck ? (
              <Button
                className="mt-4 h-auto min-h-11 max-w-full whitespace-normal"
                onClick={() => {
                  router.refresh();
                }}
                variant="outline"
              >
                <RefreshCw aria-hidden="true" />
                Повторить проверку доступа
              </Button>
            ) : null}
            <SeriesContinuationProvider materialSlug={next?.slug ?? null}>
              <div className="mt-5 grid gap-6">
                {visibleRuns(
                  part?.kind === "materials" ? part.runs : [],
                  visible.length,
                  count,
                ).map((run) => (
                  <section
                    aria-labelledby={
                      run.chapter === null
                        ? undefined
                        : `chapter-${run.chapter.id}`
                    }
                    key={run.chapter?.id ?? `open-${String(run.offset)}`}
                  >
                    {run.chapter?.header ?? null}
                    {run.rows.length === 0 ? null : (
                      <ol
                        aria-label={
                          run.chapter === null
                            ? "Материалы продукта"
                            : `Материалы главы «${run.chapter.name}»`
                        }
                        className={cn(
                          "grid gap-2",
                          run.chapter === null ? "" : "mt-3",
                        )}
                        data-series-order
                        start={run.offset + 1}
                      >
                        {run.rows.map((row) => (
                          <li
                            onClickCapture={(event) => {
                              if (
                                event.button !== 0 ||
                                event.metaKey ||
                                event.ctrlKey ||
                                event.shiftKey ||
                                event.altKey ||
                                !(event.target instanceof Element) ||
                                event.target.closest("a") === null
                              )
                                return;
                              if (
                                window.location.pathname ===
                                new URL(currentHref, window.location.origin)
                                  .pathname
                              )
                                window.history.replaceState(
                                  window.history.state,
                                  "",
                                  row.returnHref,
                                );
                            }}
                            aria-current={
                              next?.slug === row.slug ? "step" : undefined
                            }
                            className="@container/series-entry relative min-w-0 scroll-mt-6 rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
                            data-route-material={row.slug}
                            data-series-ordinal={row.ordinal}
                            key={row.slug}
                            tabIndex={-1}
                          >
                            {row.card}
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                ))}
              </div>
            </SeriesContinuationProvider>
          </>
        )}
      </div>
      {part?.kind === "materials" && hasMore ? (
        <div className="mt-6 flex justify-center" ref={sentinel}>
          <Button
            onClick={() => {
              setReveal({
                source,
                count: Math.min(visible.length, count + SERIES_BATCH_SIZE),
              });
            }}
            variant="outline"
          >
            Показать ещё уроки
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Preserve complete chapter runs while progressively extending the visible prefix. */
function visibleRuns(
  runs: readonly JourneyRun[],
  total: number,
  count: number,
): readonly JourneyRun[] {
  return runs.flatMap((run) => {
    if (run.rows.length === 0)
      return run.offset < count || count === total ? [run] : [];
    return run.offset < count
      ? [{ ...run, rows: run.rows.slice(0, count - run.offset) }]
      : [];
  });
}

/** Only a material part is progressively revealed and numbered; artifacts have no route. */
function partRows(part: JourneyPart): readonly JourneyRow[] {
  return part.kind === "materials" ? part.runs.flatMap((run) => run.rows) : [];
}

function partCount(part: JourneyPart): number {
  return part.kind === "materials" ? partRows(part).length : part.count;
}

/** «1 артефакт» / «2 артефакта» / «5 артефактов» for the live part announcement. */
function artifactsInWords(count: number): string {
  const lastTwo = count % 100;
  const lastOne = count % 10;
  const form =
    lastTwo >= 11 && lastTwo <= 14
      ? "артефактов"
      : lastOne === 1
        ? "артефакт"
        : lastOne >= 2 && lastOne <= 4
          ? "артефакта"
          : "артефактов";
  return `${String(count)} ${form}`;
}
