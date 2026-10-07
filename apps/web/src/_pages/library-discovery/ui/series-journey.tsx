import type { Route } from "next";

import {
  ProductTaskRow,
  placeChapterTasks,
  type ProductChapterTask,
} from "@/entities/product-task";
import { MaterialCard, type MaterialPreview } from "@/entities/material";
import {
  ReaderProductArtifacts,
  type ReaderProductArtifactsResult,
} from "@/features/product-artifacts.reader";
import {
  formatMaterialCount,
  type ProductChapter,
  type PublishedSeriesResult,
} from "@/features/library-discovery";
import { SeriesMaterialMarker } from "@/features/reading-progress";
import { productChapterRuns } from "@/shared/lib/product-chapter-runs";
import { seriesReaderReturnHref } from "@/shared/routing/material-reader";
import { productTaskHref } from "@/shared/routing/subscription-route";

import { formatTaskCount } from "./product-counts";
import { SERIES_BATCH_SIZE } from "./series-batch";
import {
  SeriesJourneyControls,
  type JourneyPart,
  type JourneyRun,
} from "./series-journey-controls.client";

type SeriesResult = Extract<
  PublishedSeriesResult,
  { readonly kind: "ready" | "empty" }
>;

/**
 * Состав программы: главы, уроки и артефакты. Строки рисует сервер, поэтому браузер не
 * пересобирает список при гидрации; выбор части, порционный показ и продолжение держит
 * `SeriesJourneyControls`.
 */
export function SeriesJourney({
  accessPending = false,
  artifacts = { kind: "ready", artifacts: [] },
  result,
  currentHref,
}: {
  /** Личная часть ещё идёт: строки стоят на общих данных, отметки доступа уточняются. */
  readonly accessPending?: boolean;
  readonly artifacts?: ReaderProductArtifactsResult;
  readonly result: SeriesResult;
  readonly currentHref: Route;
}) {
  const items = result.kind === "ready" ? result.items : [];
  const chapterOf = chapterLookup(result.chapters);
  // A chapter split into several runs shows its opening tasks once, before its first run.
  const ledChapters = new Set<string>();
  // An artifact part exists only for a Product the catalog resolved by id, so the
  // download address it builds is never a guess.
  const productId = result.reference.id;
  const productArtifacts =
    artifacts.kind === "ready" && productId !== undefined
      ? artifacts.artifacts
      : [];
  // Chapters are the Product programme; anything the author has not placed in one is supplementary.
  // Each part carries the chapters that apply to it, so no part identifier decides presentation.
  const materialParts: readonly {
    readonly chapters: readonly ProductChapter[];
    readonly id: "programme" | "supplementary";
    readonly items: readonly MaterialPreview[];
    readonly label: string;
    readonly shortLabel?: string;
  }[] = [
    {
      id: "programme",
      label: "Программа",
      chapters: result.chapters,
      items:
        result.chapters.length === 0
          ? items
          : items.filter((item) => chapterOf(item) !== null),
    },
    {
      id: "supplementary",
      label: "Дополнительные материалы",
      shortLabel: "Дополнительно",
      chapters: [],
      items:
        result.chapters.length === 0
          ? []
          : items.filter((item) => chapterOf(item) === null),
    },
  ];
  const parts: readonly JourneyPart[] = [
    ...materialParts.map(
      ({ chapters, id, items: partItems, label, shortLabel }) => ({
        chapterCount: chapters.length,
        id,
        kind: "materials" as const,
        label,
        ...(shortLabel === undefined ? {} : { shortLabel }),
        runs: productChapterRuns(partItems, chapters, chapterOf).map((run) =>
          journeyRun(run, { accessPending, currentHref, ledChapters, result }),
        ),
      }),
    ),
    {
      count: productArtifacts.length,
      id: "artifacts",
      kind: "artifacts",
      label: "Артефакты",
      panel: (
        <div className="mt-5">
          {artifacts.kind === "unavailable" ? (
            <p
              className="py-5 text-sm leading-6 text-muted-foreground"
              role="status"
            >
              Артефакты сейчас не загрузились. Попробуй открыть этот раздел
              позже.
            </p>
          ) : productArtifacts.length === 0 || productId === undefined ? (
            <p className="py-5 text-sm leading-6 text-muted-foreground">
              Здесь появятся файлы, шаблоны и инструменты для работы над
              проектом.
            </p>
          ) : (
            <ReaderProductArtifacts
              artifacts={productArtifacts}
              productId={productId}
            />
          )}
        </div>
      ),
    },
  ];

  // Часть артефактов есть всегда, поэтому разделы программы видны и у пустого продукта.
  return (
    <SeriesJourneyControls
      currentHref={currentHref}
      offersAccessRecheck={
        !accessPending &&
        items.some((item) => item.availability === "unavailable")
      }
      parts={parts}
    />
  );
}

/** Отрезок части с готовыми строками: порядковый номер и адрес возврата известны на сервере. */
function journeyRun(
  run: {
    readonly chapter: ProductChapter | null;
    readonly items: readonly MaterialPreview[];
    readonly offset: number;
  },
  {
    accessPending,
    currentHref,
    ledChapters,
    result,
  }: {
    readonly accessPending: boolean;
    readonly currentHref: Route;
    readonly ledChapters: Set<string>;
    readonly result: SeriesResult;
  },
): JourneyRun {
  const tasks = run.chapter?.tasks ?? [];
  const placed = placeChapterTasks(tasks, run.chapter?.materialIds ?? []);
  const taskList = (items: readonly ProductChapterTask[], label: string) =>
    items.length === 0 ? undefined : (
      <ul aria-label={label} className="mt-2 grid gap-2" data-programme-tasks>
        {items.map((task) => (
          <li className="@container/series-entry min-w-0" key={task.code}>
            <ProductTaskRow
              accessPending={accessPending}
              href={productTaskHref(result.reference.slug, task.code)}
              task={task}
            />
          </li>
        ))}
      </ul>
    );
  const leading =
    run.chapter === null || ledChapters.has(run.chapter.id)
      ? undefined
      : taskList(placed.leading, `Задания главы «${run.chapter.name}»`);
  if (run.chapter !== null) ledChapters.add(run.chapter.id);
  return {
    chapter:
      run.chapter === null
        ? null
        : {
            header: (
              <header className="programme-chapter-head">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <h3
                    className="min-w-0 flex-1 text-lg font-semibold leading-snug tracking-[-0.02em] [overflow-wrap:anywhere] sm:basis-auto sm:text-xl"
                    id={`chapter-${run.chapter.id}`}
                  >
                    {run.chapter.name}
                  </h3>
                  {run.chapter.materialIds.length > 0 || tasks.length > 0 ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {[
                        run.chapter.materialIds.length > 0
                          ? formatMaterialCount(run.chapter.materialIds.length)
                          : undefined,
                        tasks.length > 0
                          ? formatTaskCount(tasks.length)
                          : undefined,
                      ]
                        .filter((part) => part !== undefined)
                        .join(" · ")}
                    </span>
                  ) : null}
                </div>
                {/* Глава без уроков остаётся частью программы: описание объясняет, что в ней
                    будет, а пометка — что уроки ещё не вышли. С первым уроком глава становится
                    обычной и её можно проходить. */}
                {run.items.length === 0 && tasks.length === 0 ? (
                  <div className="programme-chapter-preview">
                    {run.chapter.summary === "" ? null : (
                      <p className="whitespace-pre-line text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
                        {run.chapter.summary}
                      </p>
                    )}
                    <p className="programme-chapter-soon">
                      Материалы готовятся
                    </p>
                  </div>
                ) : null}
              </header>
            ),
            id: run.chapter.id,
            name: run.chapter.name,
          },
    ...(leading === undefined ? {} : { leading }),
    offset: run.offset,
    rows: run.items.map((material, index) => {
      // Splitting the route into parts renumbers each part; a flat Product keeps its stored order.
      const ordinal =
        result.chapters.length > 0
          ? run.offset + index + 1
          : (material.seriesMemberships.find(
              ({ slug }) => slug === result.reference.slug,
            )?.ordinal ?? run.offset + index + 1);
      const returnHref = seriesReaderReturnHref(
        currentHref,
        Math.floor((run.offset + index) / SERIES_BATCH_SIZE) + 1,
        material.slug,
      );
      const after =
        material.materialId === undefined
          ? undefined
          : taskList(
              placed.after.get(material.materialId) ?? [],
              `Задания после урока «${material.title}»`,
            );
      return {
        ...(after === undefined ? {} : { after }),
        available: material.availability === "available",
        card: (
          <MaterialCard
            accessPending={accessPending}
            seriesOrdinal={ordinal}
            readingStatus={
              <SeriesMaterialMarker
                {...(material.materialId === undefined
                  ? {}
                  : { materialId: material.materialId })}
                ordinal={ordinal}
                statusOnly
              />
            }
            headingLevel={run.chapter === null ? "h3" : "h4"}
            material={material}
            returnHref={returnHref}
            variant="series"
          />
        ),
        ordinal,
        returnHref,
        slug: material.slug,
      };
    }),
  };
}

function chapterLookup(
  chapters: readonly ProductChapter[],
): (material: MaterialPreview) => string | null {
  const byMaterial = new Map(
    chapters.flatMap((chapter) =>
      chapter.materialIds.map(
        (materialId) => [materialId, chapter.id] as const,
      ),
    ),
  );
  return (material) =>
    material.materialId === undefined
      ? null
      : (byMaterial.get(material.materialId) ?? null);
}
