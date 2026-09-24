import type { Route } from "next";

import { MaterialCard, type MaterialPreview } from "@/entities/material";
import { ReaderGuideArtifacts, type ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import { formatMaterialCount, type GuideChapter, type PublishedSeriesResult } from "@/features/library-discovery";
import { SeriesMaterialMarker } from "@/features/reading-progress";
import { guideChapterRuns } from "@/shared/lib/guide-chapter-runs";
import { seriesReaderReturnHref } from "@/shared/routing/material-reader";

import { SERIES_BATCH_SIZE } from "./series-batch";
import { SeriesJourneyControls, type JourneyPart, type JourneyRun } from "./series-journey-controls.client";

type SeriesResult = Extract<PublishedSeriesResult, { readonly kind: "ready" | "empty" }>;

/**
 * Состав программы: главы, уроки и артефакты. Строки рисует сервер, поэтому браузер не
 * пересобирает список при гидрации; выбор части, порционный показ и продолжение держит
 * `SeriesJourneyControls`.
 */
export function SeriesJourney({ accessPending = false, artifacts = { kind: "ready", artifacts: [] }, result, currentHref }: {
  /** Личная часть ещё идёт: строки стоят на общих данных, отметки доступа уточняются. */
  readonly accessPending?: boolean;
  readonly artifacts?: ReaderGuideArtifactsResult;
  readonly result: SeriesResult;
  readonly currentHref: Route;
}) {
  const items = result.kind === "ready" ? result.items : [];
  const chapterOf = chapterLookup(result.chapters);
  // An artifact part exists only for a Guide the catalog resolved by id, so the
  // download address it builds is never a guess.
  const guideId = result.reference.id;
  const guideArtifacts =
    artifacts.kind === "ready" && guideId !== undefined ? artifacts.artifacts : [];
  // Chapters are the Guide programme; anything the author has not placed in one is supplementary.
  // Each part carries the chapters that apply to it, so no part identifier decides presentation.
  const materialParts: readonly {
    readonly chapters: readonly GuideChapter[];
    readonly id: "programme" | "supplementary";
    readonly items: readonly MaterialPreview[];
    readonly label: string;
  }[] = [
    { id: "programme", label: "Программа", chapters: result.chapters, items: result.chapters.length === 0 ? items : items.filter((item) => chapterOf(item) !== null) },
    { id: "supplementary", label: "Дополнительные материалы", chapters: [], items: result.chapters.length === 0 ? [] : items.filter((item) => chapterOf(item) === null) },
  ];
  const parts: readonly JourneyPart[] = [
    ...materialParts.map(({ chapters, id, items: partItems, label }) => ({
      chapterCount: chapters.length,
      id,
      kind: "materials" as const,
      label,
      runs: guideChapterRuns(partItems, chapters, chapterOf).map((run) => journeyRun(run, { accessPending, currentHref, result })),
    })),
    {
      count: guideArtifacts.length,
      id: "artifacts",
      kind: "artifacts",
      label: "Артефакты",
      panel: <div className="mt-5">{artifacts.kind === "unavailable" ? <p className="py-5 text-sm leading-6 text-muted-foreground" role="status">Артефакты сейчас не загрузились. Попробуй открыть этот раздел позже.</p> : guideArtifacts.length === 0 || guideId === undefined ? <p className="py-5 text-sm leading-6 text-muted-foreground">Здесь появятся файлы, шаблоны и инструменты для работы над проектом.</p> : <ReaderGuideArtifacts artifacts={guideArtifacts} guideId={guideId} />}</div>,
    },
  ];

  // Часть артефактов есть всегда, поэтому разделы программы видны и у пустого продукта.
  return <SeriesJourneyControls
    currentHref={currentHref}
    offersAccessRecheck={!accessPending && items.some((item) => item.availability === "unavailable")}
    parts={parts}
  />;
}

/** Отрезок части с готовыми строками: порядковый номер и адрес возврата известны на сервере. */
function journeyRun(
  run: { readonly chapter: GuideChapter | null; readonly items: readonly MaterialPreview[]; readonly offset: number },
  { accessPending, currentHref, result }: { readonly accessPending: boolean; readonly currentHref: Route; readonly result: SeriesResult },
): JourneyRun {
  return {
    chapter: run.chapter === null ? null : {
      header: <header>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h3 className="min-w-0 flex-1 text-base font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] sm:basis-auto sm:text-lg" id={`chapter-${run.chapter.id}`}>{run.chapter.name}</h3>
          {run.chapter.materialIds.length > 0 ? <span className="text-xs text-muted-foreground">{formatMaterialCount(run.chapter.materialIds.length)}</span> : null}
        </div>
        {run.items.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">Материалы готовятся</p> : null}
      </header>,
      id: run.chapter.id,
      name: run.chapter.name,
    },
    offset: run.offset,
    rows: run.items.map((material, index) => {
      // Splitting the route into parts renumbers each part; a flat Guide keeps its stored order.
      const ordinal = result.chapters.length > 0 ? run.offset + index + 1 : material.seriesMemberships.find(({ slug }) => slug === result.reference.slug)?.ordinal ?? run.offset + index + 1;
      const returnHref = seriesReaderReturnHref(currentHref, Math.floor((run.offset + index) / SERIES_BATCH_SIZE) + 1, material.slug);
      return {
        available: material.availability === "available",
        card: <MaterialCard accessPending={accessPending} seriesOrdinal={ordinal} readingStatus={<SeriesMaterialMarker {...(material.materialId === undefined ? {} : { materialId: material.materialId })} ordinal={ordinal} statusOnly />} headingLevel={run.chapter === null ? "h3" : "h4"} material={material} returnHref={returnHref} variant="series" />,
        ordinal,
        returnHref,
        slug: material.slug,
      };
    }),
  };
}

function chapterLookup(chapters: readonly GuideChapter[]): (material: MaterialPreview) => string | null {
  const byMaterial = new Map(chapters.flatMap((chapter) => chapter.materialIds.map((materialId) => [materialId, chapter.id] as const)));
  return (material) => material.materialId === undefined ? null : byMaterial.get(material.materialId) ?? null;
}
