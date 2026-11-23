"use client";

import {
  LayoutGrid,
  List,
  RefreshCw,
  Flag,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { ProductContinuationProvider } from "@/entities/material";
import {
  formatMaterialCount,
  CourseNavigationBar,
  type CatalogueTopic,
  CourseNavigationItem,
} from "@/features/library-discovery";
import { Button } from "@/shared/ui/button";
import { readShellScroll, resetShellScroll } from "@/shared/lib/shell-scroll";
import { cn } from "@/shared/lib/utils";
import { readProductPage } from "@/shared/routing/material-reader";

import {
  useProductChapterWindowChoice,
  useProductProgrammeSelection,
} from "./product-programme-selection.client";
import { PRODUCT_BATCH_SIZE } from "./product-batch";
import { observeProgrammeReveal } from "./product-journey-reveal.browser";
import {
  ProductMaterialCatalog,
  type CatalogEntry,
} from "./product-material-catalog.client";
import { useProductOnboardingPresentation } from "./product-programme-onboarding.client";
import { useProductLearning } from "./product-learning.client";
import {
  ProgrammeChapterTiles,
  type JourneyChapterTile,
  type TiledChapter,
} from "./programme-chapter-tiles.client";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";

interface ProgrammeQuery {
  readonly page: number;
  readonly hasPage: boolean;
  readonly at: string | null;
  readonly atPlacement: string | null;
  readonly catalogue: boolean;
}

/** Activity retains this Programme while the global router displays a different document. */
function useProgrammeQuery(owner: Route): ProgrammeQuery {
  const pathname = usePathname();
  const search = useSearchParams();
  const active = pathname === owner;
  const incoming: ProgrammeQuery = active
    ? {
        page: readProductPage(search.get("page")),
        hasPage: search.has("page"),
        at: search.get("at"),
        atPlacement: search.get("atPlacement"),
        catalogue: search.get("part") === "materials",
      }
    : {
        page: 1,
        hasPage: false,
        at: null,
        atPlacement: null,
        catalogue: false,
      };
  const [accepted, setAccepted] = useState({ owner, query: incoming });
  const changed =
    accepted.owner !== owner ||
    (active &&
      (accepted.query.page !== incoming.page ||
        accepted.query.hasPage !== incoming.hasPage ||
        accepted.query.at !== incoming.at ||
        accepted.query.atPlacement !== incoming.atPlacement ||
        accepted.query.catalogue !== incoming.catalogue));
  if (changed) {
    setAccepted({ owner, query: incoming });
    return incoming;
  }
  return accepted.query;
}

const subscribeToHydration = () => () => undefined;
const readClientHydration = () => true;
const readServerHydration = () => false;

/** Строка программы: её карточку нарисовал сервер, здесь только место в списке и возврат к ней. */
export interface JourneyRow {
  readonly id?: string;
  /** Задания, которые автор поставил сразу после этого урока (#947); номера уроков они не меняют. */
  readonly after?: ReactNode;
  readonly available: boolean;
  readonly card: ReactNode;
  readonly ordinal: number;
  /** Адрес урока в читателе: кнопка продолжения в окне главы ведёт сюда. */
  readonly readerHref: Route;
  readonly returnHref: Route;
  readonly slug: string;
  readonly title: string;
}

/** Непрерывный отрезок части: глава или уроки вне глав. */
export interface JourneyRun {
  readonly supplementary?: ReactNode;
  readonly chapter: {
    readonly id: string;
    readonly name: string;
    /** Плитка главы; есть только у первого отрезка главы. */
    readonly tile?: JourneyChapterTile;
    /** Темы главы в её окне, перед уроками. */
    readonly intro?: ReactNode;
    /** Неопубликованные уроки главы в работе: строки в конце её списка (#2141). */
    readonly upcoming?: readonly ReactNode[];
  } | null;
  /** Задания в начале главы, перед её первым уроком (#947). */
  readonly leading?: ReactNode;
  readonly offset: number;
  readonly rows: readonly JourneyRow[];
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
      readonly topics: readonly CatalogueTopic[];
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
export function ProductJourneyControls({
  currentHref,
  offersAccessRecheck,
  parts: suppliedParts,
}: {
  readonly currentHref: Route;
  /** Доступ к части уроков не проверился: читателю предлагается перепроверить его. */
  readonly offersAccessRecheck: boolean;
  readonly parts: readonly JourneyPart[];
}) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    readClientHydration,
    readServerHydration,
  );
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
  const query = useProgrammeQuery(currentHref);
  const router = useRouter();
  const learning = useProductLearning();
  const requestedPage = query.page;
  const requestedMaterial = query.at;
  const requestedPlacement = query.atPlacement;
  const requestedRow = (row: JourneyRow) =>
    requestedPlacement === null
      ? row.slug === requestedMaterial
      : row.id === requestedPlacement;
  const routeRef = useRef<HTMLElement>(null);
  // Возврат из урока в каталог «Материалы» приходит с `part=materials`.
  const requestedCatalog = query.catalogue;
  const defaultPart =
    parts.find((entry) => entry.kind === "onboarding" && entry.incomplete) ??
    parts.find((entry) => entry.id === "programme") ??
    parts[0];
  // Only a deliberate switch overrides the address and arriving onboarding facts.
  const [selection, setSelection] = useProductProgrammeSelection();
  const part =
    selection !== null
      ? (parts.find(({ id }) => id === selection) ?? defaultPart)
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
  const restoredCount =
    selection !== null
      ? 0
      : restoredIndex >= 0
        ? restoredIndex + 1
        : query.hasPage
          ? requestedPage * PRODUCT_BATCH_SIZE
          : resumeIndex + 1;
  // Chapters are tiles whose lessons open in a chapter window, so every lesson is there at once
  // and nothing is revealed in batches.
  const tiledChapters =
    part?.kind === "materials" && part.chapterCount > 0
      ? chapterGroups(part.runs)
      : null;
  const initialCount =
    tiledChapters !== null
      ? visible.length
      : Math.min(
          visible.length,
          Math.max(
            PRODUCT_BATCH_SIZE,
            Math.ceil(restoredCount / PRODUCT_BATCH_SIZE) * PRODUCT_BATCH_SIZE,
          ),
        );
  const source = `${currentHref}:${part?.id ?? "programme"}:${requestedMaterial ?? ""}:${String(requestedPage)}`;
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
  const next = parts
    .flatMap(partRows)
    .find((row) => row.slug === continuation?.materialSlug && row.available);
  // Кнопка в строке урока (решение владельца 09.10.2026): урок продолжения — «Продолжить»;
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

  // The chapter window: a return from a lesson reopens the chapter of that lesson.
  const returnChapter =
    tiledChapters?.find((chapter) =>
      chapter.runs.some((run) => run.rows.some(requestedRow)),
    )?.id ?? null;
  // A choice in this window holds until the address changes. The route keeps it above the
  // shared/personal replacement, so a tile chosen while personal data loads stays open (#1896).
  const [windowChoice, setWindowChoice] = useProductChapterWindowChoice();
  const openChapterId =
    windowChoice?.source === source ? windowChoice.id : returnChapter;
  const openedChapter = tiledChapters?.find(
    (chapter) => chapter.id === openChapterId,
  );
  const continuationRow =
    inlineContinuation === null
      ? undefined
      : openedChapter?.runs
          .flatMap((run) => run.rows)
          .find(
            (row) =>
              row.slug === inlineContinuation.materialSlug && row.available,
          );

  const lastLesson = useCallback(
    (node: HTMLLIElement | null) => {
      if (node === null || !hasMore) return;
      return observeProgrammeReveal(node, count > initialCount, () => {
        setReveal({
          source,
          count: Math.min(visible.length, count + PRODUCT_BATCH_SIZE),
        });
      });
    },
    [count, hasMore, initialCount, setReveal, source, visible.length],
  );

  const returnSlug =
    selection !== null
      ? undefined
      : (requestedMaterial ??
        (query.hasPage && requestedPage > 1
          ? visible[(requestedPage - 1) * PRODUCT_BATCH_SIZE]?.slug
          : undefined));
  // Preserve an established position across both initial hydration commits; later address changes
  // keep their commands: https://github.com/sachkov-inside/platform/issues/2460.
  const initialScroll = useRef<{
    readonly slug: string | undefined;
    readonly preserve: boolean;
  } | null>(null);
  // После гидрации каталог добавляет полку «Новое» и сдвигает полки ниже, поэтому карточку
  // возврата находим ещё раз; в «Новом» её копия целью не служит.
  useEffect(() => {
    const initial = (initialScroll.current ??= {
      slug: returnSlug,
      preserve: readShellScroll(routeRef.current) > 0,
    });
    if (hydrated) initialScroll.current = { slug: returnSlug, preserve: false };
    if (
      returnSlug === undefined ||
      (initial.preserve && initial.slug === returnSlug)
    )
      return;
    routeRef.current
      ?.querySelector<HTMLElement>(
        `[data-route-material="${CSS.escape(returnSlug)}"]`,
      )
      ?.scrollIntoView({ block: "center" });
  }, [returnSlug, hydrated]);

  /** Уроки отрезка нумерованным списком: строки сервера, задания после уроков и объявленные уроки. */
  function runList(
    run: JourneyRun,
    rows: readonly JourneyRow[],
    upcoming: readonly ReactNode[] = [],
  ) {
    if (rows.length === 0 && upcoming.length === 0) return null;
    return (
      <ol
        aria-label={
          run.chapter === null
            ? "Материалы продукта"
            : `Материалы главы «${run.chapter.name}»`
        }
        className={cn("grid gap-2", run.chapter === null ? "" : "mt-3")}
        data-product-order
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
                new URL(currentHref, window.location.origin).pathname
              )
                window.history.replaceState(
                  window.history.state,
                  "",
                  row.returnHref,
                );
            }}
            aria-current={next?.slug === row.slug ? "step" : undefined}
            className="@container/series-entry relative min-w-0 scroll-mt-6 rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
            data-route-material={row.slug}
            data-programme-placement={row.id}
            data-product-ordinal={row.ordinal}
            key={row.id ?? row.slug}
            // Observe the last lesson of a batch rather than the page-bottom button.
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
        {upcoming}
      </ol>
    );
  }

  function selectPart(id: JourneyPart["id"]) {
    setSelection(id);
  }
  /** Выбор раздела из нижней панели: раздел открывается с начала, как новая вкладка приложения. */
  function openPart(id: JourneyPart["id"]) {
    // Новый раздел открывается с самого верха страницы, вместе с шапкой продукта (решение
    // владельца 09.10.2026). Сбрасываем реальную оболочку до появления lastLesson нового раздела.
    resetShellScroll(routeRef.current);
    selectPart(id);
  }

  return (
    <section
      aria-labelledby="product-materials"
      className="mt-5 scroll-mt-6 focus:outline-none"
      ref={routeRef}
      tabIndex={-1}
    >
      <h2 className="sr-only" id="product-materials">
        Материалы продукта
      </h2>
      {parts.length > 1 ? (
        <p aria-live="polite" className="sr-only">
          {part?.label}:{" "}
          {part?.kind === "onboarding"
            ? part.incomplete
              ? "Не завершён"
              : "Завершён"
            : formatMaterialCount(
                part?.kind === "catalog" ? part.entries.length : visible.length,
              )}
        </p>
      ) : null}
      <div
        aria-label={part?.label}
        id={`product-part-panel-${part?.id ?? "programme"}`}
        className="focus-visible:outline-2 focus-visible:outline-ring"
      >
        {part?.kind === "onboarding" ? (
          part.panel
        ) : part?.kind === "catalog" ? (
          <ProductMaterialCatalog
            accessPending={part.accessPending}
            currentHref={currentHref}
            entries={part.entries}
            topics={part.topics}
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
            <ProductContinuationProvider
              continuation={inlineContinuation}
              reservePrevious={
                learning.kind === "loading" || learning.kind === "unavailable"
              }
            >
              {tiledChapters === null ? (
                <div className="mt-5 grid gap-6">
                  {(part?.kind === "materials" ? part.runs : []).map((run) => {
                    const sectionId = `open-run-${String(run.offset)}`;
                    return (
                      <section id={sectionId} key={sectionId}>
                        {run.leading ?? null}
                        {runList(
                          run,
                          run.rows.slice(0, Math.max(0, count - run.offset)),
                        )}
                        {run.supplementary ?? null}
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-5">
                  <ProgrammeChapterTiles
                    chapters={tiledChapters}
                    continuation={
                      continuationRow === undefined ||
                      inlineContinuation === null
                        ? null
                        : {
                            href: continuationRow.readerHref,
                            label: inlineContinuation.label,
                            title: continuationRow.title,
                          }
                    }
                    currentId={
                      tiledChapters.find((chapter) =>
                        chapter.runs.some((run) =>
                          run.rows.some((row) => row.slug === next?.slug),
                        ),
                      )?.id ?? null
                    }
                    onOpenChange={(id) => {
                      setWindowChoice({ source, id });
                    }}
                    openId={openChapterId}
                  >
                    {openedChapter === undefined ? null : (
                      // The window leads with its own continue action, so its rows do not repeat it.
                      <ProductContinuationProvider continuation={null}>
                        {openedChapter.intro ?? null}
                        {openedChapter.runs.map((run, index) => (
                          <Fragment key={`run-${String(run.offset)}`}>
                            {run.leading ?? null}
                            {runList(
                              run,
                              run.rows,
                              index === 0 ? openedChapter.upcoming : [],
                            )}
                            {run.supplementary ?? null}
                          </Fragment>
                        ))}
                      </ProductContinuationProvider>
                    )}
                  </ProgrammeChapterTiles>
                </div>
              )}
            </ProductContinuationProvider>
          </>
        )}
      </div>
      {part?.kind === "materials" && hasMore ? (
        <div className="mt-6 flex justify-center">
          <Button
            onClick={() => {
              setReveal({
                source,
                count: Math.min(visible.length, count + PRODUCT_BATCH_SIZE),
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
          disabled={!hydrated}
          onOpenPart={openPart}
          parts={parts}
        />
      ) : null}
      <ProductBottomBar
        activeId={part?.id ?? "programme"}
        disabled={!hydrated}
        onOpen={openPart}
        parts={parts}
      />
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

const partIcons: Readonly<Record<JourneyPart["id"], LucideIcon>> = {
  onboarding: Flag,
  programme: List,
  supplementary: LayoutGrid,
};
/** Only the selected section expands with its visible label. */
const partBarLabels: Readonly<Record<JourneyPart["id"], string>> = {
  onboarding: "Онбординг",
  programme: "Программа",
  supplementary: "Материалы",
};

/** The programme keeps its compact section switcher while lessons reuse its styling. */
function ProductBottomBar({
  activeId,
  disabled,
  onOpen,
  parts,
}: {
  readonly activeId: JourneyPart["id"];
  readonly disabled: boolean;
  readonly onOpen: (id: JourneyPart["id"]) => void;
  readonly parts: readonly JourneyPart[];
}) {
  return (
    <>
      {/* Место под панель в конце списка: последний урок не прячется за ней. */}
      <HidePublicFooter />
      <CourseNavigationBar label="Разделы продукта" reserveSpace>
        {parts.map((entry) => {
          const Icon = partIcons[entry.id];
          const current = entry.id === activeId;
          return (
            <CourseNavigationItem
              current={current}
              label={partBarLabels[entry.id]}
              icon={Icon}
              disabled={disabled}
              key={entry.id}
              onClick={() => {
                onOpen(entry.id);
              }}
            />
          );
        })}
      </CourseNavigationBar>
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
  disabled,
  onOpenPart,
  parts,
}: {
  readonly activeId: JourneyPart["id"];
  readonly disabled: boolean;
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
                  disabled={disabled}
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

/** Главы программы: каждая со всеми своими отрезками; плитку несёт первый отрезок главы. */
function chapterGroups(runs: readonly JourneyRun[]): readonly (TiledChapter & {
  readonly intro?: ReactNode;
  readonly runs: readonly JourneyRun[];
  readonly upcoming: readonly ReactNode[];
})[] {
  const groups = new Map<
    string,
    {
      chapter: NonNullable<JourneyRun["chapter"]>;
      runs: JourneyRun[];
    }
  >();
  for (const run of runs) {
    if (run.chapter === null) continue;
    const group = groups.get(run.chapter.id);
    if (group === undefined)
      groups.set(run.chapter.id, { chapter: run.chapter, runs: [run] });
    else group.runs.push(run);
  }
  return [...groups.values()].flatMap(({ chapter, runs: chapterRuns }) =>
    chapter.tile === undefined
      ? []
      : [
          {
            id: chapter.id,
            name: chapter.name,
            tile: chapter.tile,
            ...(chapter.intro === undefined ? {} : { intro: chapter.intro }),
            runs: chapterRuns,
            upcoming: chapter.upcoming ?? [],
          },
        ],
  );
}
