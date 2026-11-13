"use client";

import {
  LayoutGrid,
  List,
  RefreshCw,
  Flag,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import {
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
import { resetShellScroll } from "@/shared/lib/shell-scroll";
import { cn } from "@/shared/lib/utils";
import { readProductPage } from "@/shared/routing/material-reader";

import { PRODUCT_BATCH_SIZE } from "./product-batch";
import {
  ProductMaterialCatalog,
  type CatalogEntry,
} from "./product-material-catalog.client";
import { useProductOnboardingPresentation } from "./product-programme-onboarding.client";
import { useProductLearning } from "./product-learning.client";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";

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
  const search = useSearchParams();
  const router = useRouter();
  const learning = useProductLearning();
  const requestedPage = readProductPage(search.get("page"));
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
        ? requestedPage * PRODUCT_BATCH_SIZE
        : resumeIndex + 1;
  const initialCount = Math.min(
    visible.length,
    Math.max(
      PRODUCT_BATCH_SIZE,
      Math.ceil(restoredCount / PRODUCT_BATCH_SIZE) * PRODUCT_BATCH_SIZE,
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
        count: Math.min(visible.length, count + PRODUCT_BATCH_SIZE),
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
        ? visible[(requestedPage - 1) * PRODUCT_BATCH_SIZE]?.slug
        : undefined));
  // После гидрации каталог добавляет полку «Новое» и сдвигает полки ниже, поэтому карточку
  // возврата находим ещё раз; в «Новом» её копия целью не служит.
  useEffect(() => {
    if (returnSlug === undefined) return;
    routeRef.current
      ?.querySelector<HTMLElement>(
        `[data-route-material="${CSS.escape(returnSlug)}"]`,
      )
      ?.scrollIntoView({ block: "center" });
  }, [returnSlug, hydrated]);

  function selectPart(id: JourneyPart["id"]) {
    if (id === part?.id) return;
    setSelection({ id, explicit: true });
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
            : formatMaterialCount(visible.length)}
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
              <div className="mt-5 grid gap-6">
                {(part?.kind === "materials" ? part.runs : []).map((run) => {
                  const rows = run.rows.slice(
                    0,
                    Math.max(0, count - run.offset),
                  );
                  const sectionId = `${run.chapter === null ? "open" : `chapter-${run.chapter.id}`}-run-${String(run.offset)}`;
                  return (
                    <section
                      id={sectionId}
                      // A continuation keeps its chapter name without repeating its landmark.
                      role={run.chapter?.header === null ? "group" : undefined}
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
                          : run.chapter.header === null
                            ? "continuation"
                            : run.rows.length === 0
                              ? "preparing"
                              : "open"
                      }
                      key={sectionId}
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
                              data-product-ordinal={row.ordinal}
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
