import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import type {
  ProductChapterRoadmapStatus,
  ProductUpcomingLesson,
} from "@/features/library-discovery";
import { cn } from "@/shared/lib/utils";

import type {
  ChapterSummarySection,
  CourseRoadmapProgress,
} from "./course-roadmap";
import { RoadmapUpdatedOn } from "./course-roadmap-updated-on.client";
import { formatDoneChapters } from "./product-counts";

/**
 * Дорожная карта курса на вкладке «Программа» (#2141, прототип `Prototypes/Course Roadmap` принят
 * владельцем 13.11.2026): шапка с готовыми главами, датой и полоской по главам, сворачиваемые
 * главы со статусами и неопубликованные уроки главы в работе.
 */
export function CourseRoadmapHeader({
  roadmap,
  updatedOn,
}: {
  readonly roadmap: CourseRoadmapProgress;
  readonly updatedOn: string;
}) {
  return (
    <div className="mt-4 border-t border-border/70 pt-4" data-roadmap-progress>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <p className="font-medium">{formatDoneChapters(roadmap.doneCount)}</p>
        <RoadmapUpdatedOn date={updatedOn} />
      </div>
      <div
        aria-hidden="true"
        className="mt-3 flex gap-[3px]"
        data-roadmap-segments
      >
        {roadmap.chapters.map((chapter) => (
          <span
            className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border"
            data-roadmap-segment={chapter.status}
            key={chapter.id}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                chapter.status === "writing" ? "bg-accent" : "bg-primary",
              )}
              style={{ width: `${String(chapter.share * 100)}%` }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

const badgeTone = {
  writing:
    "bg-[color-mix(in_oklch,var(--accent)_12%,var(--background))] text-action",
  planned: "bg-secondary text-muted-foreground",
} as const;

/** Метка статуса: у готовой главы её нет. */
function RoadmapBadge({
  status,
}: {
  readonly status: Exclude<ProductChapterRoadmapStatus, "done">;
}) {
  // A plain space instead of a margin: when the badge wraps, it starts flush with the title.
  return (
    <>
      {" "}
      <span
        className={cn(
          "inline-flex translate-y-[-0.1em] items-center gap-1.5 rounded-full px-2 py-0.5 align-middle text-[0.6875rem] font-semibold leading-4 whitespace-nowrap sm:text-xs",
          badgeTone[status],
        )}
        data-roadmap-badge={status}
      >
        {status === "writing" ? (
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-accent"
          />
        ) : null}
        {status === "writing" ? "Пишется" : "В планах"}
      </span>
    </>
  );
}

/** Строка-заголовок главы: название, метка статуса и одна строка под ними. */
export function RoadmapChapterHeading({
  id,
  line,
  name,
  status,
}: {
  readonly id: string;
  readonly line: ReactNode;
  readonly name: string;
  readonly status: ProductChapterRoadmapStatus;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h3
        className={cn(
          "inline text-base font-semibold leading-snug tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-xl",
          status === "planned" &&
            "text-[0.9375rem] text-foreground/85 sm:text-lg",
        )}
        id={`chapter-${id}`}
      >
        {name}
      </h3>
      {status === "done" ? null : <RoadmapBadge status={status} />}
      {line === null ? null : (
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
          {line}
        </p>
      )}
    </div>
  );
}

/**
 * Глава дорожной карты. Сворачивается каждая глава, у которой есть содержимое; открыта ли она
 * сначала, решает программа. Запланированная глава без тем остаётся строкой без стрелки.
 */
export function RoadmapChapterDisclosure({
  children,
  collapsible,
  heading,
  open,
  status,
}: {
  readonly children: ReactNode;
  readonly collapsible: boolean;
  readonly heading: ReactNode;
  readonly open: boolean;
  readonly status: ProductChapterRoadmapStatus;
}) {
  if (!collapsible)
    return (
      <div data-roadmap-chapter={status}>
        {heading}
        {children}
      </div>
    );
  return (
    <details
      className="group/chapter"
      data-roadmap-chapter={status}
      open={open}
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        {heading}
        <ChevronDown
          aria-hidden="true"
          className="mt-1.5 size-4 shrink-0 text-muted-foreground motion-safe:transition-transform group-open/chapter:rotate-180"
        />
      </summary>
      {children}
    </details>
  );
}

/** Урок, который ещё не опубликован: та же геометрия строки, без ссылки, пунктирная рамка. */
export function UpcomingLessonRow({
  lesson,
  ordinal,
}: {
  readonly lesson: ProductUpcomingLesson;
  readonly ordinal: number;
}) {
  return (
    <li
      className="flex min-h-14 min-w-0 items-center gap-2 rounded-xl border border-dashed border-foreground/20 px-3 py-2.5 text-muted-foreground sm:gap-3 sm:px-4"
      data-roadmap-upcoming={lesson.state}
    >
      <span
        aria-hidden="true"
        className="w-4 shrink-0 text-left text-xs font-semibold leading-5 tabular-nums sm:w-7 sm:text-center sm:text-lg sm:leading-6"
      >
        {ordinal}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-medium leading-5 [overflow-wrap:anywhere] sm:text-base sm:leading-6">
          {lesson.title}
        </h4>
        <span className="mt-1 flex items-center gap-1.5 text-xs leading-4">
          {lesson.state === "writing" ? (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-accent"
              />
              <span className="font-medium text-action">Пишется</span>
            </>
          ) : (
            "Скоро"
          )}
        </span>
      </div>
    </li>
  );
}

/** Темы запланированной главы чипами; абзацы описания, кроме итога, — текстом. */
export function PlannedChapterTopics({
  name,
  sections,
}: {
  readonly name: string;
  readonly sections: readonly ChapterSummarySection[];
}) {
  return (
    <div className="mt-3 grid gap-3">
      {sections.map((section, index) =>
        section.kind === "topics" ? (
          <ul
            aria-label={`Темы главы «${name}»`}
            className="flex flex-wrap gap-1.5"
            key={index}
          >
            {section.topics.map((topic, topicIndex) => (
              <li
                className="max-w-full rounded-[1rem] bg-secondary px-2.5 py-1 text-xs leading-4 text-foreground/80 [overflow-wrap:anywhere]"
                key={topicIndex}
              >
                <ChapterTopic text={topic} />
              </li>
            ))}
          </ul>
        ) : (
          <p
            className="max-w-[64ch] text-sm leading-6 whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]"
            key={index}
          >
            {section.text}
          </p>
        ),
      )}
    </div>
  );
}

/** Only a leading authored label is emphasized; all content stays escaped React text. */
export function ChapterTopic({ text }: { readonly text: string }) {
  const label = /^\*\*([^*]+)\*\*\s*(.*)$/u.exec(text);
  return label === null ? (
    text
  ) : (
    <>
      <strong className="font-semibold text-foreground">{label[1]}</strong>{" "}
      {label[2]}
    </>
  );
}
