"use client";

import {
  LayoutGrid,
  ListOrdered,
  RefreshCw,
  Search,
  Flag,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  MaterialCard,
  SeriesContinuationProvider,
  type MaterialPreview,
} from "@/entities/material";
import { formatMaterialCount } from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { resetShellScroll } from "@/shared/lib/shell-scroll";
import { cn } from "@/shared/lib/utils";
import {
  catalogReaderReturnHref,
  readSeriesPage,
} from "@/shared/routing/material-reader";

import { SERIES_BATCH_SIZE } from "./series-batch";
import { useProductOnboardingPresentation } from "./product-programme-onboarding.client";
import { useSeriesLearning } from "./series-learning.client";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";

/** Строка программы: её карточку нарисовал сервер, здесь только место в списке и возврат к ней. */
export interface JourneyRow {
  readonly id?: string;
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
  readonly supplementary?: ReactNode;
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

/** Данные каталога: карточку рисует браузер только в открытом разделе и видимой порции. */
export interface CatalogEntry {
  readonly material: MaterialPreview;
  readonly inProgramme: boolean;
}

export type JourneyPart =
  | {
      readonly id: "onboarding";
      readonly kind: "onboarding";
      readonly label: string;
      readonly incomplete: boolean;
      readonly panel: ReactNode;
    }
  | {
      readonly chapterCount: number;
      readonly id: "programme";
      readonly kind: "materials";
      readonly label: string;
      /** Короткое имя вкладки для узкого экрана; полное остаётся для скринридера. */
      readonly shortLabel?: string;
      readonly runs: readonly JourneyRun[];
    }
  | {
      readonly accessPending: boolean;
      readonly entries: readonly CatalogEntry[];
      readonly id: "supplementary";
      readonly kind: "catalog";
      readonly label: string;
    };

export type ProductOnboardingPanel = Pick<
  Extract<JourneyPart, { readonly kind: "onboarding" }>,
  "panel" | "incomplete"
>;

/**
 * Управление программой в браузере: выбор части, порционный показ уроков, возврат к уроку, из
 * которого читатель пришёл, и отметка продолжения. Содержимое строк приходит готовым с сервера.
 */
export function SeriesJourneyControls({
  currentHref,
  offersAccessRecheck,
  parts: suppliedParts,
}: {
  readonly currentHref: Route;
  /** Доступ к части уроков не проверился: читателю предлагается перепроверить его. */
  readonly offersAccessRecheck: boolean;
  readonly parts: readonly JourneyPart[];
}) {
  const onboarding = useProductOnboardingPresentation();
  const parts: readonly JourneyPart[] =
    onboarding === undefined
      ? suppliedParts
      : [
          ...(onboarding === null || !onboarding.incomplete
            ? []
            : [
                {
                  id: "onboarding" as const,
                  kind: "onboarding" as const,
                  label: "Онбординг",
                  ...onboarding,
                },
              ]),
          ...suppliedParts.filter((entry) => entry.kind !== "onboarding"),
        ];
  const search = useSearchParams();
  const router = useRouter();
  const learning = useSeriesLearning();
  const requestedPage = readSeriesPage(search.get("page"));
  const requestedMaterial = search.get("at");
  const requestedPlacement = search.get("atPlacement");
  const requestedRow = (row: JourneyRow) =>
    requestedPlacement === null
      ? row.slug === requestedMaterial
      : row.id === requestedPlacement;
  const routeRef = useRef<HTMLElement>(null);
  // Возврат из урока в каталог «Материалы» приходит с `part=materials`.
  const requestedCatalog = search.get("part") === "materials";
  const defaultPart =
    parts.find((entry) => entry.kind === "onboarding" && entry.incomplete) ??
    parts.find((entry) => entry.id === "programme") ??
    parts[0];
  const [selection, setSelection] = useState(() => ({
    id: requestedCatalog
      ? ("supplementary" as const)
      : ((
          parts.find((entry) => partRows(entry).some(requestedRow)) ??
          defaultPart
        )?.id ?? "programme"),
    // An explicit switch abandons the page in the address, which belongs to the previous part.
    explicit: false,
  }));
  const part = selection.explicit
    ? (parts.find(({ id }) => id === selection.id) ?? defaultPart)
    : requestedCatalog
      ? (parts.find(({ id }) => id === "supplementary") ?? defaultPart)
      : (parts.find((entry) => partRows(entry).some(requestedRow)) ??
        defaultPart);
  const visible = part === undefined ? [] : partRows(part);
  const continuation = learning.kind === "ready" ? learning.continuation : null;
  const resumeIndex = visible.findIndex(
    (row) => row.slug === continuation?.materialSlug && row.available,
  );
  const restoredIndex = visible.findIndex(requestedRow);
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
  const lastLesson = useRef<HTMLLIElement>(null);
  const next = parts
    .flatMap(partRows)
    .find((row) => row.slug === continuation?.materialSlug && row.available);
  // Раскрытая строка в списке (решение владельца 09.10.2026): урок продолжения — «Продолжить»;
  // кто ещё не начинал — гость или читатель без прочитанных уроков — видит «Начать обучение» у
  // первого открытого урока программы.
  const notStarted =
    learning.kind === "guest" ||
    (learning.kind === "ready" && learning.read === 0);
  const firstOpen = notStarted
    ? parts
        .filter((entry) => entry.id === "programme")
        .flatMap(partRows)
        .find((row) => row.available)
    : undefined;
  const inlineContinuation =
    next === undefined
      ? firstOpen === undefined
        ? null
        : { materialSlug: firstOpen.slug, label: "Начать обучение" }
      : { materialSlug: next.slug, label: "Продолжить" };

  useEffect(() => {
    const node = lastLesson.current;
    if (
      !hasMore ||
      node === null ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const revealAheadPixels = 600;
    let observer: IntersectionObserver | undefined;
    let scrollTarget: Element | Document = node.ownerDocument;
    let frame: number | undefined;
    let revealed = false;
    const revealNextBatch = () => {
      if (revealed) return;
      revealed = true;
      observer?.disconnect();
      setReveal({
        source,
        count: Math.min(visible.length, count + SERIES_BATCH_SIZE),
      });
    };
    const checkReachedBoundary = () => {
      frame = undefined;
      if (node.getClientRects().length === 0) return;
      const bottom =
        scrollTarget instanceof Element
          ? scrollTarget.getBoundingClientRect().bottom
          : window.innerHeight;
      if (node.getBoundingClientRect().top <= bottom + revealAheadPixels) {
        revealNextBatch();
      }
    };
    const scheduleBoundaryCheck = () => {
      if (frame === undefined && !revealed)
        frame = requestAnimationFrame(checkReachedBoundary);
    };
    const observeLastLesson = () => {
      observer?.disconnect();
      scrollTarget.removeEventListener("scroll", scheduleBoundaryCheck);
      // Desktop scrolls the shell's main; phones scroll the document. Resolve again
      // on resize because the shell changes its scroll owner at the breakpoint.
      let root = node.parentElement;
      while (
        root !== null &&
        !/^(auto|scroll)$/.test(getComputedStyle(root).overflowY)
      ) {
        root = root.parentElement;
      }
      scrollTarget = root ?? node.ownerDocument;
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) revealNextBatch();
        },
        {
          root: scrollTarget,
          rootMargin: `0px 0px ${String(revealAheadPixels)}px 0px`,
        },
      );
      observer.observe(node);
      // End/scrollbar jumps can skip the entire intersection region between frames.
      // Reached or already passed boundaries must still advance without another scroll.
      scrollTarget.addEventListener("scroll", scheduleBoundaryCheck, {
        passive: true,
      });
      if (count > initialCount) scheduleBoundaryCheck();
    };
    const onResize = () => {
      observeLastLesson();
      scheduleBoundaryCheck();
    };
    observeLastLesson();
    window.addEventListener("resize", onResize);
    return () => {
      observer?.disconnect();
      scrollTarget.removeEventListener("scroll", scheduleBoundaryCheck);
      window.removeEventListener("resize", onResize);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [count, hasMore, initialCount, source, visible.length]);

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
    // Новый раздел открывается с самого верха страницы, вместе с шапкой продукта (решение
    // владельца 09.10.2026). Сбрасываем реальную оболочку до появления lastLesson нового раздела.
    resetShellScroll();
    selectPart(id);
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
          {part?.kind === "onboarding"
            ? part.incomplete
              ? "Не завершён"
              : "Завершён"
            : formatMaterialCount(visible.length)}
        </p>
      ) : null}
      <div
        aria-label={part?.label}
        id={`series-part-panel-${part?.id ?? "programme"}`}
        className="focus-visible:outline-2 focus-visible:outline-ring"
      >
        {part?.kind === "onboarding" ? (
          part.panel
        ) : part?.kind === "catalog" ? (
          <MaterialCatalog
            accessPending={part.accessPending}
            currentHref={currentHref}
            entries={part.entries}
            restoredSlug={selection.explicit ? null : requestedMaterial}
          />
        ) : (
          <>
            {part?.id === "programme" &&
            visible.length === 0 &&
            part.chapterCount === 0 ? (
              <p className="py-10 text-sm leading-6 text-muted-foreground">
                Программа готовится. Здесь появятся главы и уроки продукта.
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
            <SeriesContinuationProvider
              continuation={inlineContinuation}
              reservePrevious={
                learning.kind === "loading" || learning.kind === "unavailable"
              }
            >
              <div className="mt-5 grid gap-6">
                {(part?.kind === "materials" ? part.runs : []).map((run) => {
                  const rows = run.rows.slice(
                    0,
                    Math.max(0, count - run.offset),
                  );
                  return (
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
                      {rows.length === 0 ? null : (
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
                          {rows.map((row, index) => (
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
                              data-programme-placement={row.id}
                              data-series-ordinal={row.ordinal}
                              key={row.id ?? row.slug}
                              // Future chapter headers may extend far beyond this batch.
                              // Observe its last lesson rather than the page-bottom button.
                              ref={
                                hasMore && run.offset + index === count - 1
                                  ? lastLesson
                                  : undefined
                              }
                              tabIndex={-1}
                            >
                              {row.card}
                              {row.after ?? null}
                            </li>
                          ))}
                        </ol>
                      )}
                      {run.supplementary ?? null}
                    </section>
                  );
                })}
              </div>
            </SeriesContinuationProvider>
          </>
        )}
      </div>
      {part?.kind === "materials" && hasMore ? (
        <div className="mt-6 flex justify-center">
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

/** Only programme rows are progressively revealed and numbered. */
function partRows(part: JourneyPart): readonly JourneyRow[] {
  return part.kind === "materials" ? part.runs.flatMap((run) => run.rows) : [];
}

function partCount(part: JourneyPart): number {
  return part.kind === "onboarding"
    ? 0
    : part.kind === "materials"
      ? partRows(part).length
      : part.entries.length;
}

/** Заголовок раздела: на странице видно, что открыты «Материалы». */
function PartHeading({ title }: { readonly title: string }) {
  return (
    <h2 className="text-lg font-semibold tracking-[-0.02em] sm:text-xl">
      {title}
    </h2>
  );
}

const catalogFormats = [
  { slug: "", label: "Все" },
  { slug: "video", label: "Видео" },
  { slug: "guide", label: "Гайды" },
  { slug: "note", label: "Заметки" },
] as const;
const catalogScopes = [
  { id: "all", label: "Все" },
  { id: "programme", label: "Из программы" },
  { id: "extra", label: "Дополнительные" },
] as const;
type CatalogScope = (typeof catalogScopes)[number]["id"];

/**
 * Каталог материалов продукта: поиск по названию и описанию, фильтр формата и источника, новые
 * материалы сверху. Карточки — те же, что в ленте Главной, с превью (решение владельца
 * 09.10.2026). Программа остаётся строгим порядком глав в своём разделе.
 */
function MaterialCatalog({
  accessPending,
  currentHref,
  entries,
  restoredSlug,
}: {
  readonly accessPending: boolean;
  readonly currentHref: Route;
  readonly entries: readonly CatalogEntry[];
  readonly restoredSlug: string | null;
}) {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState("");
  const [scope, setScope] = useState<CatalogScope>("all");
  const needle = query.trim().toLocaleLowerCase("ru");
  const formats = catalogFormats.filter(
    (option) =>
      option.slug === "" ||
      entries.some((entry) => entry.material.formatSlug === option.slug),
  );
  const shown = [...entries]
    .filter(
      (entry) =>
        (needle === "" ||
          `${entry.material.title} ${entry.material.summary}`
            .toLocaleLowerCase("ru")
            .includes(needle)) &&
        (format === "" || entry.material.formatSlug === format) &&
        (scope === "all" || (scope === "programme") === entry.inProgramme),
    )
    .sort((left, right) =>
      (right.material.publishedAt ?? "").localeCompare(
        left.material.publishedAt ?? "",
      ),
    );
  const restoredIndex = shown.findIndex(
    (entry) => entry.material.slug === restoredSlug,
  );
  const initialCount = Math.max(
    SERIES_BATCH_SIZE,
    Math.ceil((restoredIndex + 1) / SERIES_BATCH_SIZE) * SERIES_BATCH_SIZE,
  );
  const source = JSON.stringify([needle, format, scope, restoredSlug]);
  const [reveal, setReveal] = useState({ source, count: initialCount });
  if (reveal.source !== source) setReveal({ source, count: initialCount });
  const count = Math.min(
    shown.length,
    Math.max(
      initialCount,
      reveal.source === source ? reveal.count : initialCount,
    ),
  );
  const chip = (active: boolean) =>
    cn(
      "inline-flex min-h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-9 sm:px-3.5 sm:text-sm",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-muted text-muted-foreground hover:text-foreground",
    );
  return (
    <div data-material-catalog>
      <PartHeading title="Материалы" />
      {/* Поиск и фильтры компактные (стандарт шкалы 09.10.2026): поле 40 px, текст ввода 16 px,
          чтобы iPhone не увеличивал страницу, подсказка мельче. */}
      <label className="mt-3 flex min-h-10 items-center gap-2 rounded-xl bg-muted px-3 sm:mt-4 sm:min-h-11 sm:gap-2.5 sm:px-3.5">
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="sr-only">Поиск по материалам курса</span>
        <input
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-sm placeholder:text-muted-foreground sm:placeholder:text-base"
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          placeholder="Найти материал"
          type="search"
          value={query}
        />
      </label>
      {/* Фильтры — один ряд: на узком экране он прокручивается вбок, а не растёт вниз. */}
      <div className="public-horizontal-rail -mx-4 mt-2.5 flex items-center gap-2 overflow-x-auto px-4 sm:mx-0 sm:mt-3 sm:flex-wrap sm:overflow-visible sm:px-0">
        <div
          aria-label="Формат материала"
          className="flex shrink-0 gap-1.5"
          role="group"
        >
          {formats.map((option) => (
            <button
              aria-pressed={format === option.slug}
              className={chip(format === option.slug)}
              key={option.slug}
              onClick={() => {
                setFormat(option.slug);
              }}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
        <div
          aria-label="Откуда материал"
          className="flex shrink-0 gap-1.5"
          role="group"
        >
          {catalogScopes.slice(1).map((option) => (
            <button
              aria-pressed={scope === option.id}
              className={chip(scope === option.id)}
              key={option.id}
              onClick={() => {
                setScope(scope === option.id ? "all" : option.id);
              }}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p
        aria-live="polite"
        className="mt-3 text-xs text-muted-foreground sm:mt-4 sm:text-sm"
      >
        {shown.length === entries.length
          ? formatMaterialCount(entries.length)
          : `Найдено: ${formatMaterialCount(shown.length)}`}
      </p>
      {shown.length === 0 ? (
        <p className="py-10 text-sm leading-6 text-muted-foreground">
          {entries.length === 0
            ? "Здесь появятся материалы курса."
            : "Ничего не нашлось. Попробуй другой запрос или сними фильтры."}
        </p>
      ) : (
        <ul
          className="mt-2 grid gap-x-6 lg:grid-cols-2"
          aria-label="Материалы курса"
        >
          {shown.slice(0, count).map((entry) => (
            <li
              className="min-w-0"
              data-route-material={entry.material.slug}
              key={entry.material.slug}
            >
              <MaterialCard
                accessPending={accessPending}
                headingLevel="h3"
                material={entry.material}
                readerContext={{ referenceView: true }}
                returnHref={catalogReaderReturnHref(
                  currentHref,
                  entry.material.slug,
                )}
                variant="feed"
              />
            </li>
          ))}
        </ul>
      )}
      {count < shown.length ? (
        <Button
          className="mt-5 min-h-11"
          onClick={() => {
            setReveal({ source, count: count + SERIES_BATCH_SIZE });
          }}
          variant="outline"
        >
          Показать ещё материалы
        </Button>
      ) : null}
    </div>
  );
}

const partIcons: Readonly<Record<JourneyPart["id"], LucideIcon>> = {
  onboarding: Flag,
  programme: ListOrdered,
  supplementary: LayoutGrid,
};
/** Labels identify both parts; only the selected mobile label is visible. */
const partBarLabels: Readonly<Record<JourneyPart["id"], string>> = {
  onboarding: "Онбординг",
  programme: "Программа",
  supplementary: "Материалы",
};

/** Programme and Materials share a floating mobile bar; the active item expands with its label. */
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
    <>
      {/* Место под панель в конце списка: последний урок не прячется за ней. */}
      <div aria-hidden="true" className="h-20 md:hidden" />
      <div aria-hidden="true" className="course-bar-fade md:hidden" />
      <nav
        aria-label="Разделы продукта"
        className="product-bottom-bar md:hidden"
      >
        <HidePublicFooter />
        {parts.map((entry) => {
          const Icon = partIcons[entry.id];
          const current = entry.id === activeId;
          return (
            <button
              aria-current={current ? "true" : undefined}
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
              <span className="product-bottom-bar-label" aria-hidden="true">
                {partBarLabels[entry.id]}
              </span>
            </button>
          );
        })}
      </nav>
    </>
  );
}

/**
 * Колонка разделов (решение владельца 09.10.2026): программа и материалы со счётчиками.
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
                  aria-current={current ? "true" : undefined}
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
        </ul>
      </nav>
    </aside>
  );
}
