import type { ProductUpcomingLesson } from "@/features/library-discovery";

import type { ChapterSummarySection } from "./course-roadmap";

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
