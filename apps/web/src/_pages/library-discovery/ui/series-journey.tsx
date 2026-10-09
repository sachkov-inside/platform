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
          ? items
          : items.filter((item) => chapterOf(item) !== null),
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
      // Материалы — каталог всех материалов продукта карточками: поиск, фильтры, новые сверху
      // (решение владельца 09.10.2026). Программа остаётся строгим порядком глав.
      entries: items.map((item) => ({
        card: (
          // Карточка уходит клиенту в массиве: ключ нужен и элементу-значению.
          <MaterialCard
            accessPending={accessPending}
            headingLevel="h3"
            key={item.slug}
            material={item}
            returnHref={currentHref}
            variant="feed"
          />
        ),
        format: item.format,
        formatSlug: item.formatSlug ?? "",
        inProgramme: result.chapters.length === 0 || chapterOf(item) !== null,
        publishedAt: item.publishedAt ?? "",
        slug: item.slug,
        text: `${item.title} ${item.summary}`.toLocaleLowerCase("ru"),
      })),
      id: "supplementary",
      kind: "catalog",
      label: "Материалы",
    },
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
                {/* Счётчик и метка «Скоро» стоят сразу за названием главы, мелко (референс
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
                      Скоро
                    </span>
                  ) : run.chapter.materialIds.length > 0 || tasks.length > 0 ? (
                    <span className="ml-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
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
                {/* Глава без уроков остаётся частью программы, но коротко: метка «Скоро» и первая
                    фраза описания (решение владельца 09.10.2026). С первым уроком глава
                    становится обычной и её можно проходить. */}
                {preparing && run.chapter.summary !== "" ? (
                  <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-5 text-muted-foreground [overflow-wrap:anywhere] sm:text-sm">
                    {firstSentence(run.chapter.summary)}
                  </p>
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

/** Первая фраза описания главы: будущая глава в программе называется одной мыслью. */
function firstSentence(text: string): string {
  const match = /^.+?[.!?…](?=\s|$)/su.exec(text.trim());
  return match === null ? text.trim() : match[0];
}
