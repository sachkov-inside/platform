"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ContentCoverImage } from "@/entities/material";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import { formatMaterialCount, type PublishedSeriesResult } from "@/features/library-discovery";
import { guideProductHref, guideProgrammeHref, guidePurchaseHref } from "@/shared/routing/subscription-route";
import "./guide-programme-view.css";

import { formatChapterCount } from "./guide-counts";
import { SeriesJourney, type SeriesLearningView } from "./series-journey.client";

type ResolvedSeriesResult = Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;

/**
 * Программа руководства: главы, материалы и состояния доступа. Продажа живёт здесь одним
 * приглашением: страница продукта продаёт смыслом, цену и оформление показывает страница оплаты.
 */
export function GuideProgrammeView({
  artifacts,
  result,
  learning,
}: {
  readonly artifacts?: ReaderGuideArtifactsResult;
  readonly result: ResolvedSeriesResult;
  readonly learning?: SeriesLearningView;

}) {
  const slug = result.reference.slug;
  const currentHref = guideProgrammeHref(slug);
  const productHref = guideProductHref(slug);
  const items = result.kind === "ready" ? result.items : [];
  const locked = items.some((item) => item.availability === "locked");
  const availableCount = items.filter((item) => item.availability === "available").length;
  const meta = [
    result.chapters.length === 0 ? undefined : formatChapterCount(result.chapters.length),
    formatMaterialCount(items.length),
    availableCount === 0 ? undefined : availableCount === items.length ? "всё открыто" : `открыто: ${String(availableCount)}`,
  ].filter((value): value is string => value !== undefined);

  return (
    <div
      className="@container/programme mx-auto min-w-0 w-full max-w-[46rem]"
      data-guide-programme={slug}
    >
      <nav aria-label="Путь навигации" className="pt-4">
        <Link
          className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
          href={productHref}
        >
          <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
          <span>О практикуме</span>
        </Link>
      </nav>

      <header className="mt-2 rounded-2xl bg-muted/60 p-4 sm:p-5">
        <div className="flex items-center gap-4 @max-[20rem]/programme:flex-col @max-[20rem]/programme:items-start">
          <div className="w-16 shrink-0 overflow-hidden rounded-lg sm:w-20"><ContentCoverImage alt="" className="aspect-square min-h-0 w-full" cover={result.reference.cover ?? null} fallbackKind="playlist" fallbackSeed={slug} /></div>
          <div className="min-w-0 [overflow-wrap:anywhere]"><h1 className="break-words text-xl font-semibold leading-tight tracking-[-0.025em] sm:text-2xl">{result.reference.name}</h1><p className="mt-2 text-xs leading-5 text-muted-foreground sm:text-sm">{meta.join(" · ")}</p></div>
        </div>
        {locked ? <div className="mt-4 flex justify-end"><Link className="guide-purchase-cta" href={guidePurchaseHref(slug)}>Оплатить практикум</Link></div> : null}
        {learning === undefined || learning.kind === "guest" ? null : <div className="mt-4 min-h-12 border-t border-border pt-3">
          {learning.kind === "ready" && learning.total > 0 ? <>
            <div className="mb-2 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"><span>Изучено {learning.read} из {learning.total}</span><span>{Math.round(100 * learning.read / learning.total)}%</span></div>
            <progress aria-label="Прогресс практикума" className="block h-1.5 w-full overflow-hidden rounded-full accent-primary" max={learning.total} value={learning.read} />
          </> : learning.kind === "loading" ? <p className="text-xs text-muted-foreground" role="status">Загружаем прогресс…</p> : learning.kind === "unavailable" ? <p className="text-xs text-muted-foreground">Прогресс сейчас не загрузился. Материалы можно читать.</p> : null}
        </div>}
      </header>


      <SeriesJourney
        {...(artifacts === undefined ? {} : { artifacts })}
        currentHref={currentHref}
        {...(learning === undefined ? {} : { learning })}
        result={{ ...result, discoveryKind: "series" }}
      />
    </div>
  );
}
