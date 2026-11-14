import type { MaterialPreview } from "@/entities/material";
import type {
  ProductChapter,
  ProductChapterRoadmapStatus,
} from "@/features/library-discovery";

/**
 * Дорожная карта курса на вкладке «Программа» (#2141): что в курсе готово, что пишется и что в
 * планах. Статус главы хранит автор; без него глава с уроками считается готовой, а без уроков —
 * запланированной.
 */
export function chapterRoadmapStatus(
  chapter: Pick<ProductChapter, "roadmapStatus">,
  hasContent: boolean,
): ProductChapterRoadmapStatus {
  return chapter.roadmapStatus ?? (hasContent ? "done" : "planned");
}

export interface RoadmapChapterProgress {
  readonly id: string;
  readonly status: ProductChapterRoadmapStatus;
  /** Опубликованные уроки главы. */
  readonly ready: number;
  /** Объявленные, но ещё не опубликованные уроки главы в работе. */
  readonly upcoming: number;
  /** Закрашенная доля сегмента главы в полоске шапки, от 0 до 1. */
  readonly share: number;
}

export interface CourseRoadmapProgress {
  readonly chapters: readonly RoadmapChapterProgress[];
  readonly doneCount: number;
}

/**
 * Статусы и доли глав для шапки и списка программы. Урок главы — опубликованный Material, который
 * программа ставит в эту главу: размещением, если программа их знает, иначе составом главы.
 */
export function courseRoadmap({
  chapters,
  items,
  programmePlacements,
}: {
  readonly chapters: readonly ProductChapter[];
  readonly items: readonly MaterialPreview[];
  readonly programmePlacements?:
    | readonly {
        readonly materialId: string;
        readonly chapterId: string | null;
      }[]
    | undefined;
}): CourseRoadmapProgress {
  const published = new Set(items.map((item) => item.materialId));
  const progress = chapters.map((chapter): RoadmapChapterProgress => {
    const materialIds =
      programmePlacements === undefined
        ? chapter.materialIds
        : programmePlacements
            .filter((placement) => placement.chapterId === chapter.id)
            .map((placement) => placement.materialId);
    const ready = materialIds.filter((id) => published.has(id)).length;
    const tasks = (chapter.tasks ?? []).filter(
      (task) => task.programmeVisibility !== "embedded",
    ).length;
    const status = chapterRoadmapStatus(chapter, ready > 0 || tasks > 0);
    const upcoming =
      status === "writing" ? (chapter.upcomingLessons ?? []).length : 0;
    return {
      id: chapter.id,
      status,
      ready,
      upcoming,
      share:
        status === "done"
          ? 1
          : status === "writing" && ready + upcoming > 0
            ? ready / (ready + upcoming)
            : 0,
    };
  });
  return {
    chapters: progress,
    doneCount: progress.filter(({ status }) => status === "done").length,
  };
}

const genitiveMonths = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

/**
 * «13 ноября» для даты текущего года, иначе «13 ноября 2025». Пока текущий год неизвестен
 * (`null`: сервер не читает часы при отрисовке), год остаётся в строке.
 */
export function formatRoadmapUpdatedOn(
  date: string,
  currentYear: number | null,
): string {
  const [year = "", month = "", day = ""] = date.split("-");
  const name = genitiveMonths[Number(month) - 1] ?? "";
  const dayMonth = `${String(Number(day))} ${name}`;
  return Number(year) === currentYear ? dayMonth : `${dayMonth} ${year}`;
}

export type ChapterSummarySection =
  | { readonly kind: "topics"; readonly topics: readonly string[] }
  | { readonly kind: "text"; readonly text: string };

/**
 * Описание главы: первый абзац — итог главы, абзац из строк `- ` — её темы, остальные абзацы —
 * текст. Одно правило для готовых и запланированных глав.
 */
export function parseChapterSummary(summary: string): {
  readonly outcome: string;
  readonly sections: readonly ChapterSummarySection[];
} {
  const [outcome = "", ...sections] = summary.trim().split(/\n\s*\n/u);
  if (outcome === "") return { outcome, sections: [] };
  return {
    outcome,
    sections: sections.map((section): ChapterSummarySection => {
      const lines = section.split("\n").map((line) => line.trim());
      return lines.every((line) => line.startsWith("- "))
        ? { kind: "topics", topics: lines.map((line) => line.slice(2)) }
        : { kind: "text", text: section };
    }),
  };
}
