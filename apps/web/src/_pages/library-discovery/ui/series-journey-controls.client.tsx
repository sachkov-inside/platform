"use client";

import {
  Library,
  ListOrdered,
  RefreshCw,
  Shapes,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
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
  /** Задания, которые автор поставил сразу после этого урока (#947); номера уроков они не меняют. */
  readonly after?: ReactNode;
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
  /** Задания в начале главы, перед её первым уроком (#947). */
  readonly leading?: ReactNode;
  readonly offset: number;
  readonly rows: readonly JourneyRow[];
}

export type JourneyPart =
  | {
      readonly chapterCount: number;
      readonly id: "programme" | "supplementary";
      readonly kind: "materials";
      readonly label: string;
      /** Короткое имя вкладки для узкого экрана; полное остаётся для скринридера. */
      readonly shortLabel?: string;
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
      : search.has("page")
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
  /** Выбор раздела из нижней панели: раздел открывается с начала, как новая вкладка приложения. */
  function openPart(id: JourneyPart["id"]) {
    selectPart(id);
    requestAnimationFrame(() => {
      routeRef.current?.scrollIntoView({ block: "start" });
    });
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
        <p aria-live="polite" className="sr-only">
          {part?.label}:{" "}
          {part?.kind === "artifacts"
            ? artifactsInWords(part.count)
            : formatMaterialCount(visible.length)}
        </p>
      ) : null}
      <div
        aria-label={part?.label}
        id={`series-part-panel-${part?.id ?? "programme"}`}
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
                    className={
                      run.chapter === null ? undefined : "programme-chapter"
                    }
                    data-chapter-state={
                      run.chapter === null
                        ? undefined
                        : run.rows.length === 0
                          ? "preparing"
                          : "open"
                    }
                    key={run.chapter?.id ?? `open-${String(run.offset)}`}
                  >
                    {run.chapter?.header ?? null}
                    {run.leading ?? null}
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
                            {row.after ?? null}
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
      {parts.length > 1 ? (
        <ProgrammeSidebar
          activeId={part?.id ?? "programme"}
          onOpenPart={openPart}
          parts={parts}
        />
      ) : null}
      {parts.length > 1 ? (
        <ProductBottomBar
          activeId={part?.id ?? "programme"}
          onOpen={openPart}
          parts={parts}
        />
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

const partIcons: Readonly<Record<JourneyPart["id"], LucideIcon>> = {
  programme: ListOrdered,
  supplementary: Library,
  artifacts: Shapes,
};
/** Имена пунктов нижней панели для скринридера: на экране у пунктов только значки. */
const partBarLabels: Readonly<Record<JourneyPart["id"], string>> = {
  programme: "Программа",
  supplementary: "Материалы",
  artifacts: "Артефакты",
};

/**
 * Нижняя панель продукта на телефоне (решение владельца 09.10.2026), только значки, как
 * в общей навигации: подписи на узком экране не помещаются. Внутри программы она заменяет общую
 * навигацию: разделы продукта — те же, что вкладки на широком экране, — и профиль. Главной здесь
 * нет: выход на витрину стоит вверху слева, и случайно уйти из курса нельзя; ряд вкладок там спрятан, чтобы разделы не уходили во второй ряд.
 * Атрибут `data-hide-mobile-navigation` убирает общую панель, её место занимает эта.
 */
function ProductBottomBar({
  activeId,
  onOpen,
  parts,
}: {
  readonly activeId: JourneyPart["id"];
  readonly onOpen: (id: JourneyPart["id"]) => void;
  readonly parts: readonly JourneyPart[];
}) {
  return (
    <nav
      aria-label="Разделы продукта"
      className="product-bottom-bar md:hidden"
      data-hide-mobile-navigation
    >
      {parts.map((entry) => {
        const Icon = partIcons[entry.id];
        const current = entry.id === activeId;
        return (
          <button
            aria-current={current ? "page" : undefined}
            aria-label={partBarLabels[entry.id]}
            className="product-bottom-bar-item"
            data-current={current}
            key={entry.id}
            onClick={() => {
              onOpen(entry.id);
            }}
            type="button"
          >
            <Icon aria-hidden="true" />
          </button>
        );
      })}
      <Link
        aria-label="Профиль"
        className="product-bottom-bar-item"
        href="/account"
      >
        <UserRound aria-hidden="true" />
      </Link>
    </nav>
  );
}

/**
 * Колонка разделов (решение владельца 09.10.2026): программа, материалы, артефакты со счётчиками.
 * Сама программа остаётся в основной колонке справа; колонка прилипает к верху. На компьютере у
 * пунктов подписи, на планшете колонка сужается до значков и несёт профиль, на телефоне её роль
 * играет нижняя панель.
 */
function ProgrammeSidebar({
  activeId,
  onOpenPart,
  parts,
}: {
  readonly activeId: JourneyPart["id"];
  readonly onOpenPart: (id: JourneyPart["id"]) => void;
  readonly parts: readonly JourneyPart[];
}) {
  return (
    <aside className="programme-sidebar" data-programme-sidebar>
      <nav aria-label="Разделы продукта" className="programme-sidebar-inner">
        <ul className="programme-sidebar-parts">
          {parts.map((entry) => {
            const Icon = partIcons[entry.id];
            const current = entry.id === activeId;
            return (
              <li key={entry.id}>
                <button
                  aria-current={current ? "page" : undefined}
                  data-current={current}
                  onClick={() => {
                    onOpenPart(entry.id);
                  }}
                  type="button"
                >
                  <Icon aria-hidden="true" />
                  <span>{partBarLabels[entry.id]}</span>
                  {partCount(entry) > 0 ? (
                    <small>{partCount(entry)}</small>
                  ) : null}
                </button>
              </li>
            );
          })}
          {/* На планшете у раздела нет шапки сайта и нижней панели: профиль — здесь. */}
          <li className="programme-sidebar-profile">
            <Link href="/account">
              <UserRound aria-hidden="true" />
              <span>Профиль</span>
            </Link>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
