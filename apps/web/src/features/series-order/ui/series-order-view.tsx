import { guideChapterRuns } from "@/shared/lib/guide-chapter-runs";
import { presentText } from "@/shared/lib/text";
import { cn } from "@/shared/lib/utils";

import {
  publicationStateLabel,
  type GuideChapterPresentation,
  type SeriesOrderItemPresentation,
} from "../model/presentation";

/**
 * Состав продукта, перенесённого из источника (#844). Backend отклоняет запись такого состава из
 * редактора, поэтому здесь нет ни одного действия правки: автор читает состав и уходит со страницы
 * без отказа.
 */
export function SeriesOrderView({
  chapters,
  items,
}: {
  readonly chapters: readonly GuideChapterPresentation[];
  readonly items: readonly SeriesOrderItemPresentation[];
}) {
  return (
    <section className="text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-y border-border py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="text-xl font-semibold">Материалы продукта</h2>
          <span className="text-sm tabular-nums text-muted-foreground">
            {items.length}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Состав меняется только переносом из источника.
        </p>
      </header>
      {items.length === 0 && chapters.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          В продукте пока нет материалов.
        </p>
      ) : (
        <div className="mt-2 grid gap-8">
          {guideChapterRuns(
            items,
            chapters,
            ({ chapterId }) => chapterId ?? null,
          ).map((section) => (
            <ChapterSection
              chapter={section.chapter}
              grouped={chapters.length > 0}
              items={section.items}
              key={section.chapter?.id ?? `open-${String(section.offset)}`}
              number={
                section.chapter === null
                  ? null
                  : chapters.indexOf(section.chapter) + 1
              }
              offset={section.offset}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ChapterSection({
  chapter,
  grouped,
  items,
  number,
  offset,
}: {
  readonly chapter: GuideChapterPresentation | null;
  readonly grouped: boolean;
  readonly items: readonly SeriesOrderItemPresentation[];
  readonly number: number | null;
  readonly offset: number;
}) {
  if (chapter === null && !grouped) {
    return (
      <MaterialList items={items} label="Материалы продукта" offset={offset} />
    );
  }
  const headingId = `chapter-${chapter?.id ?? `open-${String(offset)}`}`;
  const summary = presentText(chapter?.summary.trim());
  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <div className="border-b border-border pb-3 pt-4">
        {chapter === null ? (
          <h3
            className="text-sm font-semibold text-muted-foreground"
            id={headingId}
          >
            Вне глав
          </h3>
        ) : (
          <h3
            className="flex min-w-0 gap-2 text-lg font-semibold"
            id={headingId}
          >
            <span
              aria-hidden="true"
              className="w-6 shrink-0 text-center text-sm font-normal leading-7 tabular-nums text-muted-foreground"
            >
              {number}
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="sr-only">Глава {number}: </span>
              {chapter.name}
            </span>
          </h3>
        )}
        {summary === undefined ? null : (
          <p className="mt-2 whitespace-pre-line pl-8 text-sm leading-6 text-muted-foreground">
            {summary}
          </p>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-2 py-5 text-sm text-muted-foreground">
          В главе пока нет материалов.
        </p>
      ) : (
        <MaterialList
          items={items}
          label={
            chapter === null
              ? "Материалы вне глав"
              : `Материалы главы «${chapter.name}»`
          }
          offset={offset}
        />
      )}
    </section>
  );
}

function MaterialList({
  items,
  label,
  offset,
}: {
  readonly items: readonly SeriesOrderItemPresentation[];
  readonly label: string;
  readonly offset: number;
}) {
  return (
    <ol aria-label={label} className="divide-y divide-border">
      {items.map((item, index) => {
        const stepGroup = presentText(item.stepGroup?.trim());
        return (
          <li
            className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 py-4 sm:gap-x-3"
            key={item.materialId}
          >
            <span className="w-6 text-center text-sm leading-6 tabular-nums text-muted-foreground">
              {offset + index + 1}
            </span>
            <div className="min-w-0">
              <p className="font-medium leading-snug [overflow-wrap:anywhere]">
                {item.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span
                  className={cn(
                    item.publicationState !== "published" &&
                      "font-medium text-action",
                  )}
                >
                  {publicationStateLabel(item.publicationState)}
                </span>
                {stepGroup === undefined ? null : (
                  <span className="[overflow-wrap:anywhere]">
                    {" · "}
                    {stepGroup}
                  </span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
