"use client";

import { ArrowLeft, ArrowRight, Play, RefreshCw } from "lucide-react";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MaterialCard } from "@/entities/material";
import type { MaterialPreview } from "@/entities/material";
import { ReaderGuideArtifacts, type ReaderGuideArtifact, type ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import { formatMaterialCount, type GuideChapter, type PublishedSeriesResult } from "@/features/library-discovery";
import { SeriesMaterialMarker } from "@/features/reading-progress";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { guideChapterRuns } from "@/shared/lib/guide-chapter-runs";
import { readSeriesPage, seriesReaderReturnHref } from "@/shared/routing/material-reader";
import { seriesPage, SERIES_PAGE_SIZE } from "../model/series-page";

export type SeriesLearningView =
  | { readonly kind: "guest" }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly read: number; readonly total: number; readonly continuation: { readonly materialSlug: string; readonly label: string } | null };

type SeriesResult = Extract<PublishedSeriesResult, { readonly kind: "ready" | "empty" }>;

export function SeriesJourney({ artifacts = { kind: "ready", artifacts: [] }, result, currentHref, learning = { kind: "guest" } }: {
  readonly artifacts?: ReaderGuideArtifactsResult;
  readonly result: SeriesResult;
  readonly currentHref: Route;
  readonly learning?: SeriesLearningView;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const requestedPage = readSeriesPage(search.get("page"));
  const requestedMaterial = search.get("at");
  const routeRef = useRef<HTMLElement>(null);
  const items = result.kind === "ready" ? result.items : [];
  const chapterOf = chapterLookup(result.chapters);
  // An artifact part exists only for a Guide the catalog resolved by id, so the
  // download address it builds is never a guess.
  const guideId = result.reference.id;
  const guideArtifacts =
    artifacts.kind === "ready" && guideId !== undefined ? artifacts.artifacts : [];
  // Chapters are the Guide programme; anything the author has not placed in one is supplementary.
  // Each part carries the chapters that apply to it, so no part identifier decides presentation.
  const materialParts: readonly GuidePart[] = [
    { id: "programme", kind: "materials", label: "Программа", chapters: result.chapters, items: result.chapters.length === 0 ? items : items.filter((item) => chapterOf(item) !== null) },
    { id: "supplementary", kind: "materials", label: "Дополнительные материалы", chapters: [], items: result.chapters.length === 0 ? [] : items.filter((item) => chapterOf(item) === null) },
  ];
  const parts: readonly GuidePart[] = [...materialParts, { artifacts: guideArtifacts, guideId, id: "artifacts", kind: "artifacts", label: "Артефакты" }];
  const [selection, setSelection] = useState(() => ({
    id: (parts.find((entry) => partItems(entry).some((item) => item.slug === requestedMaterial)) ?? parts[0])?.id ?? "programme",
    // An explicit switch abandons the page in the address, which belongs to the previous part.
    explicit: false,
  }));
  const part = parts.find(({ id }) => id === selection.id) ?? parts[0];
  const visible = part === undefined ? [] : partItems(part);
  const continuation = learning.kind === "ready" ? learning.continuation : null;
  const resumeIndex = visible.findIndex((item) => item.slug === continuation?.materialSlug && item.availability === "available");
  const resumePage = resumeIndex < 0 ? undefined : Math.floor(resumeIndex / SERIES_PAGE_SIZE) + 1;
  const restoredIndex = visible.findIndex((item) => item.slug === requestedMaterial);
  const restoredPage = restoredIndex >= 0
    ? Math.floor(restoredIndex / SERIES_PAGE_SIZE) + 1
    : !selection.explicit && search.has("page") ? requestedPage : resumePage ?? 1;
  const [navigation, setNavigation] = useState({ source: restoredPage, page: restoredPage });
  if (navigation.source !== restoredPage) setNavigation({ source: restoredPage, page: restoredPage });
  const page = seriesPage(visible, navigation.source === restoredPage ? navigation.page : restoredPage, resumePage);
  // The header shows progress; the continuation stays on the actual lesson.
  const next = items.find((item) => item.slug === continuation?.materialSlug && item.availability === "available");

  useEffect(() => {
    if (resumePage === undefined || search.has("page") || search.has("at")) return;
    if (window.location.pathname === new URL(currentHref, window.location.origin).pathname) {
      window.history.replaceState(null, "", seriesReaderReturnHref(currentHref, page.number));
    }
  }, [currentHref, page.number, resumePage, search]);

  useEffect(() => {
    if (requestedMaterial === null || page.number !== restoredPage) return;
    const row = routeRef.current?.querySelector<HTMLElement>(`[data-route-material="${CSS.escape(requestedMaterial)}"]`);
    row?.scrollIntoView({ block: "center" });
  }, [page.number, requestedMaterial, restoredPage]);

  function selectPart(id: string) {
    if (id === part?.id) return;
    setSelection({ id, explicit: true });
    setNavigation({ source: 1, page: 1 });
  }

  function navigate(number: number) {
    setNavigation({ source: restoredPage, page: number });
    const href = seriesReaderReturnHref(currentHref, number);
    if (window.location.pathname === new URL(currentHref, window.location.origin).pathname) window.history.pushState(null, "", href);
    requestAnimationFrame(() => {
      routeRef.current?.focus({ preventScroll: true });
      routeRef.current?.scrollIntoView({ block: "start" });
    });
  }

  return <>
    {result.kind === "ready" || result.chapters.length > 0 || parts.length > materialParts.length || artifacts.kind === "unavailable" ? <section aria-labelledby="series-materials" className="mt-5 scroll-mt-6 focus:outline-none" ref={routeRef} tabIndex={-1}>
      <h2 className="sr-only" id="series-materials">Материалы продукта</h2>
      {parts.length > 1 ? <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-1 border-b border-border" role="tablist" aria-label="Разделы продукта">
        {parts.map((entry) => <button
          aria-controls={`series-part-panel-${entry.id}`}
          aria-selected={entry.id === part?.id}
          className={cn("relative min-h-11 max-w-full py-2 text-sm font-semibold whitespace-normal transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", entry.id === part?.id ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground" : "text-muted-foreground hover:text-foreground")}
          id={`series-part-${entry.id}`}
          key={entry.id}
          onClick={() => { selectPart(entry.id); }}
          onKeyDown={(event) => {
            const position = parts.findIndex(({ id }) => id === entry.id);
            const destination = event.key === "ArrowRight" ? (position + 1) % parts.length
              : event.key === "ArrowLeft" ? (position - 1 + parts.length) % parts.length
              : event.key === "Home" ? 0
              : event.key === "End" ? parts.length - 1
              : -1;
            const moved = destination < 0 ? undefined : parts[destination];
            if (moved === undefined) return;
            event.preventDefault();
            selectPart(moved.id);
            requestAnimationFrame(() => { document.getElementById(`series-part-${moved.id}`)?.focus(); });
          }}
          role="tab"
          tabIndex={entry.id === part?.id ? 0 : -1}
          type="button"
        >
          {entry.label}
          {partCount(entry) > 0 ? <span className="ml-1.5 tabular-nums font-normal text-muted-foreground">{partCount(entry)}</span> : null}
        </button>)}
      </div> : null}
      {parts.length > 1 ? <p aria-live="polite" className="sr-only">{part?.label}: {part?.kind === "artifacts" ? artifactsInWords(part.artifacts.length) : formatMaterialCount(visible.length)}</p> : null}
      <div aria-labelledby={part === undefined ? undefined : `series-part-${part.id}`} id={`series-part-panel-${part?.id ?? "programme"}`} role={parts.length > 1 ? "tabpanel" : undefined} tabIndex={parts.length > 1 ? 0 : undefined} className="focus-visible:outline-2 focus-visible:outline-ring">
        {part?.kind === "artifacts" ? <div className="mt-5">{artifacts.kind === "unavailable" ? <p className="py-5 text-sm leading-6 text-muted-foreground" role="status">Артефакты сейчас не загрузились. Попробуй открыть этот раздел позже.</p> : part.artifacts.length === 0 || part.guideId === undefined ? <p className="py-5 text-sm leading-6 text-muted-foreground">Здесь появятся файлы, шаблоны и инструменты для работы над проектом.</p> : <ReaderGuideArtifacts artifacts={part.artifacts} guideId={part.guideId} />}</div> : <>
        {part?.id === "programme" && visible.length === 0 && part.chapters.length === 0 ? <p className="py-10 text-sm leading-6 text-muted-foreground">Программа готовится. Здесь появятся главы и уроки практикума.</p> : null}
        {part?.id === "supplementary" && visible.length === 0 ? <p className="py-10 text-sm leading-6 text-muted-foreground">Здесь появятся дополнительные разборы и полезные материалы к практикуму.</p> : null}
        {page.count > 1 ? <p aria-live="polite" className="mt-6 text-sm tabular-nums text-muted-foreground">Материалы {page.offset + 1}–{page.offset + page.items.length} из {visible.length}</p> : null}
        {items.some((item) => item.availability === "unavailable") ? <Button className="mt-4 h-auto min-h-11 max-w-full whitespace-normal" onClick={() => { router.refresh(); }} variant="outline"><RefreshCw aria-hidden="true" />Повторить проверку доступа</Button> : null}
        <div className="mt-5 grid gap-6">
          {visibleChapterRuns(visible, part?.chapters ?? [], chapterOf, page).map((run) => <section aria-labelledby={run.chapter === null ? undefined : `chapter-${run.chapter.id}`} key={run.chapter?.id ?? `open-${String(run.offset)}`}>
            {run.chapter === null ? null : <header>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h3 className="min-w-0 flex-1 text-base font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] sm:basis-auto sm:text-lg" id={`chapter-${run.chapter.id}`}>{run.chapter.name}</h3>
                {run.chapter.materialIds.length > 0 ? <span className="text-xs text-muted-foreground">{formatMaterialCount(run.chapter.materialIds.length)}</span> : null}
              </div>
              {run.items.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Материалы готовятся</p> : null}
            </header>}
            {run.items.length === 0 ? null : <ol aria-label={run.chapter === null ? "Материалы продукта" : `Материалы главы «${run.chapter.name}»`} className={cn("grid gap-2", run.chapter === null ? "" : "mt-3")} data-series-order start={run.offset + 1}>
              {run.items.map((material, index) => {
                // Splitting the route into parts renumbers each part; a flat Guide keeps its stored order.
                const ordinal = result.chapters.length > 0 ? run.offset + index + 1 : material.seriesMemberships.find(({ slug }) => slug === result.reference.slug)?.ordinal ?? run.offset + index + 1;
                return <li aria-current={next?.slug === material.slug ? "step" : undefined} className="@container/series-entry relative min-w-0 scroll-mt-6 rounded-xl focus-visible:outline-2 focus-visible:outline-ring" data-route-material={material.slug} data-series-ordinal={ordinal} key={material.slug} tabIndex={-1}>
                  <MaterialCard seriesOrdinal={ordinal} readingStatus={<SeriesMaterialMarker {...(material.materialId === undefined ? {} : { materialId: material.materialId })} ordinal={ordinal} statusOnly />} headingLevel={run.chapter === null ? "h3" : "h4"} material={material} {...(next?.slug === material.slug && continuation !== null ? { resumeLabel: continuation.label } : {})} returnHref={seriesReaderReturnHref(currentHref, page.number, material.slug)} variant="series" />
                </li>;
              })}
            </ol>}
          </section>)}
        </div>
        </>}
      </div>
      {part?.kind === "materials" && page.count > 1 ? <nav aria-label="Страницы маршрута" className="mt-7 flex flex-wrap items-center justify-between gap-3">
        <Button className="min-h-11" disabled={page.number === 1} onClick={() => { navigate(page.number - 1); }} variant="outline"><ArrowLeft aria-hidden="true" />Назад</Button>
        <div className="flex flex-wrap items-center gap-1">
          {page.pages.map((number, index) => number === null ? <span aria-hidden="true" className="px-1 text-muted-foreground" key={`gap-${String(index)}`}>…</span> : <Button aria-current={page.number === number ? "page" : undefined} aria-label={`Страница ${String(number)}${number === resumePage ? ", продолжение" : ""}`} className="min-h-11 min-w-11 tabular-nums" key={number} onClick={() => { navigate(number); }} variant={page.number === number ? "default" : "ghost"}>{number}{number === resumePage ? <Play aria-hidden="true" className="size-3 fill-current" /> : null}</Button>)}
        </div>
        <Button className="min-h-11" disabled={page.number === page.count} onClick={() => { navigate(page.number + 1); }} variant="outline">Далее<ArrowRight aria-hidden="true" /></Button>
      </nav> : null}
    </section> : null}
  </>;
}

/**
 * Chapters group the whole published route, so the runs are built once over the complete
 * composition and then narrowed to the visible page. A chapter that holds nothing appears on the
 * page its position falls on, so the reader still sees that it is part of the Guide.
 */
function visibleChapterRuns(
  items: readonly MaterialPreview[],
  chapters: readonly GuideChapter[],
  chapterOf: (material: MaterialPreview) => string | null,
  page: { readonly count: number; readonly items: readonly MaterialPreview[]; readonly number: number; readonly offset: number },
): readonly { readonly chapter: GuideChapter | null; readonly items: readonly MaterialPreview[]; readonly offset: number }[] {
  const from = page.offset;
  const to = page.offset + page.items.length;
  return guideChapterRuns(items, chapters, chapterOf)
    .flatMap((run) => {
      if (run.items.length === 0) {
        const trailing = run.offset >= items.length && page.number === page.count;
        return run.offset >= from && (run.offset < to || trailing) ? [run] : [];
      }
      const start = Math.max(run.offset, from);
      const end = Math.min(run.offset + run.items.length, to);
      return end > start
        ? [{ chapter: run.chapter, items: run.items.slice(start - run.offset, end - run.offset), offset: start }]
        : [];
    });
}

type GuidePart =
  | {
      readonly chapters: readonly GuideChapter[];
      readonly id: string;
      readonly items: readonly MaterialPreview[];
      readonly kind: "materials";
      readonly label: string;
    }
  | {
      readonly artifacts: readonly ReaderGuideArtifact[];
      readonly guideId: string | undefined;
      readonly id: "artifacts";
      readonly kind: "artifacts";
      readonly label: string;
    };

/** Only a route part is paginated and numbered; an artifact part has no route. */
function partItems(part: GuidePart): readonly MaterialPreview[] {
  return part.kind === "materials" ? part.items : [];
}

function partCount(part: GuidePart): number {
  return part.kind === "materials" ? part.items.length : part.artifacts.length;
}

/** «1 артефакт» / «2 артефакта» / «5 артефактов» for the live part announcement. */
function artifactsInWords(count: number): string {
  const lastTwo = count % 100;
  const lastOne = count % 10;
  const form = lastTwo >= 11 && lastTwo <= 14 ? "артефактов"
    : lastOne === 1 ? "артефакт"
    : lastOne >= 2 && lastOne <= 4 ? "артефакта"
    : "артефактов";
  return `${String(count)} ${form}`;
}

function chapterLookup(chapters: readonly GuideChapter[]): (material: MaterialPreview) => string | null {
  const byMaterial = new Map(chapters.flatMap((chapter) => chapter.materialIds.map((materialId) => [materialId, chapter.id] as const)));
  return (material) => material.materialId === undefined ? null : byMaterial.get(material.materialId) ?? null;
}
