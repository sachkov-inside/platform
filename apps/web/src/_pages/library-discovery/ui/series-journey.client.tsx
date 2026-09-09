"use client";

import { ArrowLeft, ArrowRight, Play, RefreshCw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MaterialCard } from "@/entities/material";
import type { MaterialPreview } from "@/entities/material";
import { formatMaterialCount, type GuideChapter, type PublishedSeriesResult } from "@/features/library-discovery";
import { SeriesMaterialMarker, SeriesProgress } from "@/features/reading-progress";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { guideChapterRuns } from "@/shared/lib/guide-chapter-runs";
import { materialReaderHref, readSeriesPage, seriesReaderReturnHref } from "@/shared/routing/material-reader";
import { seriesPage, SERIES_PAGE_SIZE } from "../model/series-page";

export type SeriesLearningView =
  | { readonly kind: "guest" }
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly read: number; readonly total: number; readonly continuation: { readonly materialSlug: string; readonly label: string } | null };

type SeriesResult = Extract<PublishedSeriesResult, { readonly kind: "ready" | "empty" }>;

export function SeriesJourney({ result, currentHref, learning = { kind: "guest" }, onRetry }: {
  readonly result: SeriesResult;
  readonly currentHref: Route;
  readonly learning?: SeriesLearningView;
  readonly onRetry?: (() => void) | undefined;
}) {
  const search = useSearchParams();
  const router = useRouter();
  const requestedPage = readSeriesPage(search.get("page"));
  const requestedMaterial = search.get("at");
  const routeRef = useRef<HTMLElement>(null);
  const items = result.kind === "ready" ? result.items : [];
  const chapterOf = chapterLookup(result.chapters);
  // Chapters are the Guide programme; anything the author has not placed in one is a second part.
  // Each part carries the chapters that apply to it, so no part identifier decides presentation.
  const parts: readonly GuidePart[] = result.chapters.length === 0
    ? [{ id: "programme", label: "Программа", chapters: [], items }]
    : [
        { id: "programme", label: "Программа", chapters: result.chapters, items: items.filter((item) => chapterOf(item) !== null) },
        { id: "other", label: "Другие материалы", chapters: [], items: items.filter((item) => chapterOf(item) === null) },
      ].filter((entry, index) => index === 0 || entry.items.length > 0);
  const [selection, setSelection] = useState(() => ({
    id: (parts.find((entry) => entry.items.some((item) => item.slug === requestedMaterial)) ?? parts[0])?.id ?? "programme",
    // An explicit switch abandons the page in the address, which belongs to the previous part.
    explicit: false,
  }));
  const part = parts.find(({ id }) => id === selection.id) ?? parts[0];
  const visible = part?.items ?? [];
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
  const next = items.find((item) => item.slug === continuation?.materialSlug && item.availability === "available");
  const first = items.find((item) => item.availability === "available");
  const complete = learning.kind === "ready" && learning.total > 0 && learning.read === learning.total;
  const canStart = learning.kind === "guest" || (learning.kind === "ready" && learning.read === 0 && continuation === null);
  const target = next ?? (canStart ? first : undefined);
  // The continuation may live in another part, so its page is counted inside the part that holds it.
  const targetPart = parts.find((entry) => entry.items.some((item) => item.slug === target?.slug));
  const targetPage = targetPart === undefined
    ? 1
    : Math.floor(targetPart.items.findIndex((item) => item.slug === target?.slug) / SERIES_PAGE_SIZE) + 1;
  const targetHref = target === undefined ? undefined : materialReaderHref(target.slug, seriesReaderReturnHref(currentHref, targetPage, target.slug));

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
    {items.length > 0 ? <section aria-label="Прохождение руководства" className="mt-8 grid min-h-52 gap-6 md:min-h-36 xl:min-h-28 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] md:items-center md:gap-12" data-series-learning={learning.kind}>
      <div className="min-w-0">
        {learning.kind === "guest" ? <>
          <h2 className="text-lg font-semibold">Изучайте в своём темпе</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Войдите, чтобы сохранять прогресс и возвращаться к месту остановки.</p>
          <Link className="mt-3 inline-flex min-h-11 items-center font-semibold text-action underline-offset-4 hover:underline" href="/account">Войти</Link>
        </> : <SeriesProgress view={learning} />}
        {learning.kind === "unavailable" ? <Button className="mt-3 h-auto min-h-11 max-w-full whitespace-normal" onClick={onRetry} variant="outline"><RefreshCw aria-hidden="true" />Повторить загрузку прогресса</Button> : null}
      </div>
      <div className="min-w-0">
        {target !== undefined && targetHref !== undefined && !complete ? <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
          <div className="min-w-0 max-w-sm">
            <p className="text-sm text-muted-foreground">{next === undefined ? "Первый материал" : "Продолжить изучение"}</p>
            <h2 className="mt-1 line-clamp-2 break-words text-lg font-semibold leading-7">{target.title}</h2>
          </div>
          <Button asChild className="h-auto min-h-11 max-w-full whitespace-normal [overflow-wrap:anywhere]" size="lg"><Link href={targetHref}><Play aria-hidden="true" className="size-4" />{next === undefined ? "Начать руководство" : continuation?.label === "Продолжить здесь" ? "Продолжить" : continuation?.label}</Link></Button>
        </div> : complete ? <p className="max-w-md leading-7 text-muted-foreground">Можно вернуться к любому материалу в маршруте и повторить нужное.</p> : learning.kind === "loading" ? <p className="text-muted-foreground">Ищем место продолжения…</p> : learning.kind === "unavailable" ? <p className="text-sm leading-6 text-muted-foreground">Материалы можно открыть в маршруте ниже.</p> : <p className="text-sm leading-6 text-muted-foreground">Выберите материал в маршруте. Условия доступа указаны на карточках.</p>}
      </div>
    </section> : null}
    {result.kind === "ready" || result.chapters.length > 0 ? <section aria-labelledby="series-materials" className="mt-10 scroll-mt-6 focus:outline-none" ref={routeRef} tabIndex={-1}>
      <h2 className="sr-only" id="series-materials">Материалы руководства</h2>
      {parts.length > 1 ? <div className="flex flex-wrap items-center gap-1 rounded-full bg-muted p-1" role="tablist" aria-label="Разделы руководства">
        {parts.map((entry) => <button
          aria-controls={`series-part-panel-${entry.id}`}
          aria-selected={entry.id === part?.id}
          className={cn("min-h-11 rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", entry.id === part?.id ? "bg-background text-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}
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
          <span className="ml-2 tabular-nums font-normal text-muted-foreground">{entry.items.length}</span>
        </button>)}
      </div> : null}
      {parts.length > 1 ? <p aria-live="polite" className="sr-only">{part?.label}: {formatMaterialCount(visible.length)}</p> : null}
      <div aria-labelledby={part === undefined ? undefined : `series-part-${part.id}`} id={`series-part-panel-${part?.id ?? "programme"}`} role={parts.length > 1 ? "tabpanel" : undefined} tabIndex={parts.length > 1 ? 0 : undefined} className="focus-visible:outline-2 focus-visible:outline-ring">
        {page.count > 1 ? <p aria-live="polite" className="mt-6 text-sm tabular-nums text-muted-foreground">Материалы {page.offset + 1}–{page.offset + page.items.length} из {visible.length}</p> : null}
        {items.some((item) => item.availability === "unavailable") ? <Button className="mt-4 h-auto min-h-11 max-w-full whitespace-normal" onClick={() => { router.refresh(); }} variant="outline"><RefreshCw aria-hidden="true" />Повторить проверку доступа</Button> : null}
        <div className="mt-6 grid gap-10">
          {visibleChapterRuns(visible, part?.chapters ?? [], chapterOf, page).map((run) => <section aria-labelledby={run.chapter === null ? undefined : `chapter-${run.chapter.id}`} key={run.chapter?.id ?? `open-${String(run.offset)}`}>
            {run.chapter === null ? null : <header className="border-b border-border pb-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">Глава {result.chapters.indexOf(run.chapter) + 1} из {result.chapters.length}</p>
                <h3 className="min-w-0 flex-1 basis-full text-xl font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] sm:basis-auto sm:text-2xl" id={`chapter-${run.chapter.id}`}>{run.chapter.name}</h3>
              </div>
              {run.items.length === 0 ? <p className="mt-3 inline-flex min-h-8 items-center rounded-full bg-muted px-3 text-sm font-medium text-muted-foreground">Материалы готовятся</p> : null}
            </header>}
            {run.items.length === 0 ? null : <ol aria-label={run.chapter === null ? "Материалы руководства" : `Материалы главы «${run.chapter.name}»`} className={cn("grid gap-4", run.chapter === null ? "" : "mt-5")} data-series-order start={run.offset + 1}>
              {run.items.map((material, index) => {
                // Splitting the route into parts renumbers each part; a flat Guide keeps its stored order.
                const ordinal = result.chapters.length > 0 ? run.offset + index + 1 : material.seriesMemberships.find(({ slug }) => slug === result.reference.slug)?.ordinal ?? run.offset + index + 1;
                return <li aria-current={next?.slug === material.slug ? "step" : undefined} className="@container/series-entry relative grid scroll-mt-6 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-2xl focus-visible:outline-2 focus-visible:outline-ring" data-route-material={material.slug} data-series-ordinal={ordinal} key={material.slug} tabIndex={-1}>
                  {run.items.length > 1 ? <span aria-hidden="true" className="pointer-events-none absolute left-[15px] w-0 border-l-2 border-dashed border-border" data-series-rail style={{ top: index === 0 ? "50%" : "-1rem", bottom: index === run.items.length - 1 ? "50%" : "-1rem" }} /> : null}
                  <div className="relative z-10 flex min-h-11 items-center"><SeriesMaterialMarker {...(material.materialId === undefined ? {} : { materialId: material.materialId })} ordinal={ordinal} /></div>
                  <MaterialCard headingLevel={run.chapter === null ? "h3" : "h4"} material={material} {...(next?.slug === material.slug && continuation !== null ? { resumeLabel: continuation.label } : {})} returnHref={seriesReaderReturnHref(currentHref, page.number, material.slug)} variant="series" />
                </li>;
              })}
            </ol>}
          </section>)}
        </div>
      </div>
      {page.count > 1 ? <nav aria-label="Страницы маршрута" className="mt-7 flex flex-wrap items-center justify-between gap-3">
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

interface GuidePart {
  readonly chapters: readonly GuideChapter[];
  readonly id: string;
  readonly items: readonly MaterialPreview[];
  readonly label: string;
}

function chapterLookup(chapters: readonly GuideChapter[]): (material: MaterialPreview) => string | null {
  const byMaterial = new Map(chapters.flatMap((chapter) => chapter.materialIds.map((materialId) => [materialId, chapter.id] as const)));
  return (material) => material.materialId === undefined ? null : byMaterial.get(material.materialId) ?? null;
}
