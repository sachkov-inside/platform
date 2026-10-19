import type { Route } from "next";

import {
  ProductTaskRow,
  placeChapterTasks,
  type ProductChapterTask,
} from "@/entities/product-task";
import { MaterialCard, type MaterialPreview } from "@/entities/material";
import type { ReaderProductArtifactsResult } from "@/features/product-artifacts.reader";
import {
  CourseReferenceNavigation,
  type ProductChapter,
  type PublishedSeriesResult,
} from "@/features/library-discovery";
import { SeriesMaterialMarker } from "@/features/reading-progress";
import { productChapterRuns } from "@/shared/lib/product-chapter-runs";
import { materialReaderHref } from "@/shared/routing/material-reader";
import { seriesReaderReturnHref } from "@/shared/routing/material-reader";
import { productTaskHref } from "@/shared/routing/subscription-route";
import { ChapterSummary } from "./course-programme-overview";

import { formatStepCount } from "./product-counts";
import { SERIES_BATCH_SIZE } from "./series-batch";
import {
  SeriesJourneyControls,
  type JourneyPart,
  type JourneyRun,
  type ProductOnboardingPanel,
} from "./series-journey-controls.client";

type SeriesResult = Extract<
  PublishedSeriesResult,
  { readonly kind: "ready" | "empty" }
>;

/**
 * Состав программы: главы и уроки. Строки рисует сервер, поэтому браузер не
 * пересобирает список при гидрации; выбор части, порционный показ и продолжение держит
 * `SeriesJourneyControls`.
 */
export function SeriesJourney({
  accessPending = false,
  result,
  currentHref,
  onboarding,
}: {
  /** Личная часть ещё идёт: строки стоят на общих данных, отметки доступа уточняются. */
  readonly accessPending?: boolean;
  readonly artifacts?: ReaderProductArtifactsResult;
  readonly result: SeriesResult;
  readonly currentHref: Route;
  readonly onboarding?: ProductOnboardingPanel;
}) {
  const items = result.kind === "ready" ? result.items : [];
  const chapterOf = chapterLookup(result.chapters);
  const programmeItems =
    result.programmePlacements === undefined
      ? items
      : result.programmePlacements.flatMap((placement) => {
          const material = items.find(
            (item) => item.materialId === placement.materialId,
          );
          return material === undefined
            ? []
            : [
                {
                  ...material,
                  programmePlacementId: placement.id,
                  programmeChapterId: placement.chapterId,
                },
              ];
        });
  // A chapter split into several runs shows its opening tasks once, before its first run.
  const ledChapters = new Set<string>();
  // Chapters are the Product programme; anything the author has not placed in one is supplementary.
  // Each part carries the chapters that apply to it, so no part identifier decides presentation.
  const materialParts: readonly {
    readonly chapters: readonly ProductChapter[];
    readonly id: "programme";
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
          ? programmeItems
          : programmeItems.filter((item) => chapterOf(item) !== null),
    },
  ];
  const parts: readonly JourneyPart[] = [
    ...(onboarding === undefined || !onboarding.incomplete
      ? []
      : [
          {
            id: "onboarding" as const,
            kind: "onboarding" as const,
            label: "Онбординг",
            incomplete: onboarding.incomplete,
            panel: onboarding.panel,
          },
        ]),
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
      // Материалы — каталог всех материалов продукта карточками: поиск, фильтры, новые сверху
      // (решение владельца 09.10.2026). Программа остаётся строгим порядком глав.
      accessPending,
      entries: items.map((material) => ({
        material,
        inProgramme:
          result.programmePlacements === undefined
            ? result.chapters.length === 0 || chapterOf(material) !== null
            : result.programmePlacements.some(
                (entry) => entry.materialId === material.materialId,
              ),
      })),
      id: "supplementary",
      kind: "catalog",
      label: "Материалы",
    },
  ];

  // Программа и каталог доступны также у пустого продукта.
  return (
    <SeriesJourneyControls
      currentHref={currentHref}
      {...(process.env.NODE_ENV !== "production" &&
      result.reference.slug === "ai-engineering"
        ? { prototypeChapters: result.chapters }
        : {})}
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
  const tasks = (run.chapter?.tasks ?? []).filter(
    (task) => task.programmeVisibility !== "embedded",
  );
  const unified =
    run.chapter?.tasks?.some(
      (task) => task.programmeVisibility === "embedded",
    ) === true;
  const placed = placeChapterTasks(tasks, run.chapter?.materialIds ?? []);
  const taskList = (items: readonly ProductChapterTask[], label: string) =>
    items.length === 0 ? undefined : (
      <ul
        aria-label={label}
        className="mt-2 grid gap-2"
        data-programme-tasks
        key={`tasks-${label}`}
      >
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
  const preparing = run.items.length === 0 && tasks.length === 0;
  const visitedMaterials = new Set<string>();
  return {
    chapter:
      run.chapter === null
        ? null
        : {
            header: (
              // Заголовок уходит клиентскому компоненту в массиве глав: React требует ключ и у
              // элемента, переданного как значение, иначе пишет предупреждение в консоль.
              <header
                className="programme-chapter-head"
                key={`head-${run.chapter.id}`}
              >
                {/* Счётчик и метка «Материалы готовятся» стоят сразу за названием главы, мелко (референс
                    владельца 09.10.2026). */}
                <div className="min-w-0">
                  <h3
                    className="inline text-base font-semibold leading-snug tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-xl"
                    id={`chapter-${run.chapter.id}`}
                  >
                    {run.chapter.name}
                  </h3>
                  {preparing ? (
                    <span className="programme-chapter-soon ml-2 align-[2px]">
                      Материалы готовятся
                    </span>
                  ) : run.chapter.materialIds.length > 0 || tasks.length > 0 ? (
                    <span className="ml-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {formatStepCount(
                        run.chapter.materialIds.length + tasks.length,
                      )}
                    </span>
                  ) : null}
                </div>
                <ChapterSummary
                  name={run.chapter.name}
                  summary={run.chapter.summary}
                  showOutcome={run.chapter.materialIds.length === 0}
                />
              </header>
            ),
            id: run.chapter.id,
            name: run.chapter.name,
          },
    ...(leading === undefined ? {} : { leading }),
    supplementary:
      run.chapter == null ? null : (
        <CourseReferenceNavigation
          courseHref={currentHref}
          references={(run.chapter.supplementaryMaterialIds ?? []).flatMap(
            (id) => {
              const material =
                result.kind === "ready"
                  ? result.items.find((item) => item.materialId === id)
                  : undefined;
              return material === undefined
                ? []
                : [
                    {
                      id: `material:${material.slug}`,
                      slug: material.slug,
                      title: material.title,
                      href: materialReaderHref(material.slug, currentHref, {
                        referenceView: true,
                      }),
                    },
                  ];
            },
          )}
        />
      ),
    offset: run.offset,
    rows: run.items.map((material, index) => {
      const placementId =
        "programmePlacementId" in material &&
        typeof material.programmePlacementId === "string"
          ? material.programmePlacementId
          : undefined;
      // Splitting the route into parts renumbers each part; a flat Product keeps its stored order.
      const ordinal =
        result.chapters.length > 0 || result.programmePlacements !== undefined
          ? run.offset + index + 1
          : (material.seriesMemberships.find(
              ({ slug }) => slug === result.reference.slug,
            )?.ordinal ?? run.offset + index + 1);
      const returnHref = seriesReaderReturnHref(
        currentHref,
        Math.floor((run.offset + index) / SERIES_BATCH_SIZE) + 1,
        material.slug,
        placementId,
      );
      const after =
        material.materialId === undefined ||
        visitedMaterials.has(material.materialId)
          ? undefined
          : taskList(
              placed.after.get(material.materialId) ?? [],
              `Задания после урока «${material.title}»`,
            );
      if (material.materialId !== undefined)
        visitedMaterials.add(material.materialId);
      return {
        ...(placementId === undefined ? {} : { id: placementId }),
        ...(after === undefined ? {} : { after }),
        available: material.availability === "available",
        card: (
          <MaterialCard
            readerContext={{ placementId }}
            showFormat={!unified}
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
    "programmeChapterId" in material
      ? typeof material.programmeChapterId === "string"
        ? material.programmeChapterId
        : null
      : material.materialId === undefined
        ? null
        : (byMaterial.get(material.materialId) ?? null);
}
