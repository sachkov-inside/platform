"use client";

import { ArrowDown, ArrowLeft, ArrowRight, Play, RefreshCw } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MaterialCard } from "@/entities/material";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { SeriesMaterialMarker, SeriesProgress } from "@/features/reading-progress";
import { Button } from "@/shared/ui/button";
import { materialReaderHref, readSeriesPage, seriesReaderReturnHref } from "@/shared/routing/material-reader";
import { seriesSteps } from "../model/series-steps";
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
  const restoredIndex = items.findIndex((item) => item.slug === requestedMaterial);
  const restoredPage = restoredIndex < 0 ? requestedPage : Math.floor(restoredIndex / SERIES_PAGE_SIZE) + 1;
  const [navigation, setNavigation] = useState({ source: restoredPage, page: restoredPage });
  if (navigation.source !== restoredPage) setNavigation({ source: restoredPage, page: restoredPage });
  const page = seriesPage(items, navigation.source === restoredPage ? navigation.page : restoredPage);
  const steps = seriesSteps(items, result.reference.slug);
  const continuation = learning.kind === "ready" ? learning.continuation : null;
  const next = items.find((item) => item.slug === continuation?.materialSlug && item.availability === "available");
  const first = items.find((item) => item.availability === "available");
  const complete = learning.kind === "ready" && learning.total > 0 && learning.read === learning.total;
  const canStart = learning.kind === "guest" || (learning.kind === "ready" && learning.read === 0 && continuation === null);
  const target = next ?? (canStart ? first : undefined);
  const targetIndex = items.findIndex((item) => item.slug === target?.slug);
  const targetPage = Math.floor(targetIndex / SERIES_PAGE_SIZE) + 1;
  const targetHref = target === undefined ? undefined : materialReaderHref(target.slug, seriesReaderReturnHref(currentHref, targetPage, target.slug));

  useEffect(() => {
    if (requestedMaterial === null || page.number !== restoredPage) return;
    const row = routeRef.current?.querySelector<HTMLElement>(`[data-route-material="${CSS.escape(requestedMaterial)}"]`);
    row?.scrollIntoView({ block: "center" });
  }, [page.number, requestedMaterial, restoredPage]);

  function navigate(number: number, slug?: string) {
    setNavigation({ source: restoredPage, page: number });
    const href = seriesReaderReturnHref(currentHref, number, slug);
    // Embedded views keep their host URL; a collection route owns its history.
    if (window.location.pathname === new URL(currentHref, window.location.origin).pathname) window.history.pushState(null, "", href);
    requestAnimationFrame(() => {
      const row = slug === undefined ? undefined : routeRef.current?.querySelector<HTMLElement>(`[data-route-material="${CSS.escape(slug)}"]`);
      const element = row ?? routeRef.current;
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: row === undefined ? "start" : "center" });
    });
  }

  return <>
    {items.length > 0 ? <section aria-label="Прохождение серии" className="mt-6 grid min-h-44 gap-6 rounded-2xl bg-muted/55 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] md:items-center md:gap-10" data-series-learning={learning.kind}>
      <div className="min-w-0">
        {learning.kind === "guest" ? <>
          <h2 className="text-lg font-semibold">Изучайте в своём темпе</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Войдите, чтобы сохранять прогресс и возвращаться к месту остановки.</p>
          <Link className="mt-3 inline-flex min-h-11 items-center font-semibold text-action underline-offset-4 hover:underline" href="/account">Войти</Link>
        </> : <SeriesProgress view={learning} />}
        {learning.kind === "unavailable" ? <Button className="mt-3 h-auto min-h-11 max-w-full whitespace-normal" onClick={onRetry} variant="outline"><RefreshCw aria-hidden="true" />Повторить загрузку прогресса</Button> : null}
      </div>
      <div className="min-w-0">
        {target !== undefined && targetHref !== undefined && !complete ? <>
          <h2 className="text-sm font-medium text-muted-foreground">{next === undefined ? "Первый материал" : "Продолжить изучение"}</h2>
          <p className="mt-2 break-words text-lg font-semibold leading-7">{target.title}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button asChild className="min-h-11" size="lg"><Link href={targetHref}><Play aria-hidden="true" className="size-4" />{next === undefined ? "Начать серию" : continuation?.label === "Продолжить здесь" ? "Продолжить" : continuation?.label}</Link></Button>
            <Button className="min-h-11 whitespace-normal" onClick={() => { navigate(targetPage, target.slug); }} variant="ghost"><ArrowDown aria-hidden="true" />Показать в маршруте</Button>
          </div>
        </> : complete ? <p className="max-w-md leading-7 text-muted-foreground">Можно вернуться к любому материалу в маршруте и повторить нужное.</p> : learning.kind === "loading" ? <p className="text-muted-foreground">Ищем место продолжения…</p> : learning.kind === "unavailable" ? <p className="text-sm leading-6 text-muted-foreground">Материалы можно открыть в маршруте ниже.</p> : <p className="text-sm leading-6 text-muted-foreground">Выберите материал в маршруте. Условия доступа указаны на карточках.</p>}
      </div>
    </section> : null}
    {result.kind === "ready" ? <section aria-labelledby="series-materials" className="mt-10 scroll-mt-6 focus:outline-none" ref={routeRef} tabIndex={-1}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl" id="series-materials">Маршрут</h2>
        {page.count > 1 ? <p aria-live="polite" className="text-sm tabular-nums text-muted-foreground">Материалы {page.offset + 1}–{page.offset + page.items.length} из {items.length}</p> : null}
      </div>
      {items.some((item) => item.availability === "unavailable") ? <Button className="mt-4 h-auto min-h-11 max-w-full whitespace-normal" onClick={() => { router.refresh(); }} variant="outline"><RefreshCw aria-hidden="true" />Повторить проверку доступа</Button> : null}
      <ol aria-label="Материалы серии" className="mt-5 grid gap-4" data-series-order start={page.offset + 1}>
        {page.items.map((material, index) => {
          const ordinal = material.seriesMemberships.find(({ slug }) => slug === result.reference.slug)?.ordinal ?? page.offset + index + 1;
          const step = steps.get(material.slug);
          return <li aria-current={next?.slug === material.slug ? "step" : undefined} className="relative grid scroll-mt-6 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-2xl focus-visible:outline-2 focus-visible:outline-ring" data-route-material={material.slug} data-series-ordinal={ordinal} key={material.slug} tabIndex={-1}>
            {page.items.length > 1 ? <span aria-hidden="true" className="pointer-events-none absolute left-[15px] w-0 border-l-2 border-dashed border-border" data-series-rail style={{ top: index === 0 ? "50%" : "-1rem", bottom: index === page.items.length - 1 ? "50%" : "-1rem" }} /> : null}
            <div className="relative z-10 flex min-h-11 items-center"><SeriesMaterialMarker {...(material.materialId === undefined ? {} : { materialId: material.materialId })} ordinal={ordinal} /></div>
            <MaterialCard headingLevel="h3" material={material} {...(next?.slug === material.slug && continuation !== null ? { resumeLabel: continuation.label } : {})} returnHref={seriesReaderReturnHref(currentHref, page.number, material.slug)} rowAnnotation={step === undefined ? undefined : <span className="mt-2 flex flex-wrap items-baseline gap-x-1 text-xs leading-5" data-series-step><span className="font-semibold">Шаг {step.ordinal} из {step.total}</span><span aria-hidden="true">·</span><span className="break-words text-muted-foreground">{step.label}</span></span>} variant="row" showAccessDetails />
          </li>;
        })}
      </ol>
      {page.count > 1 ? <nav aria-label="Страницы маршрута" className="mt-7 flex flex-wrap items-center justify-between gap-3">
        <Button className="min-h-11" disabled={page.number === 1} onClick={() => { navigate(page.number - 1); }} variant="outline"><ArrowLeft aria-hidden="true" />Назад</Button>
        <div className="flex flex-wrap items-center gap-1">
          {page.pages.map((number, index) => number === null ? <span aria-hidden="true" className="px-1 text-muted-foreground" key={`gap-${String(index)}`}>…</span> : <Button aria-current={page.number === number ? "page" : undefined} aria-label={`Страница ${String(number)}`} className="min-h-11 min-w-11 tabular-nums" key={number} onClick={() => { navigate(number); }} variant={page.number === number ? "default" : "ghost"}>{number}</Button>)}
        </div>
        <Button className="min-h-11" disabled={page.number === page.count} onClick={() => { navigate(page.number + 1); }} variant="outline">Далее<ArrowRight aria-hidden="true" /></Button>
      </nav> : null}
    </section> : null}
  </>;
}
