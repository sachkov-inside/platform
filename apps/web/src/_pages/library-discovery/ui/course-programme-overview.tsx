import { ChevronDown, Clock3 } from "lucide-react";
import type { ReactNode } from "react";

import type { ProductChapter } from "@/features/library-discovery";

import "./course-programme-overview.css";

/** Upcoming chapters reveal their complete authored description in one disclosure. */
export function PreparingChapter({
  chapter,
}: {
  readonly chapter: ProductChapter;
}) {
  return (
    <details className="course-preparing-chapter">
      <summary>
        <div className="min-w-0">
          <h3
            className="inline text-base font-semibold leading-snug tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-xl"
            id={`chapter-${chapter.id}`}
          >
            {chapter.name}
          </h3>
        </div>
        <ChevronDown aria-hidden="true" />
      </summary>
      <p className="course-chapter-preparing-notice">
        <Clock3 aria-hidden="true" />
        <span>
          Материалы этой главы готовятся и появятся по мере развития курса.
        </span>
      </p>
      <ChapterSummary name={chapter.name} summary={chapter.summary} expanded />
    </details>
  );
}

/** Chapter copy remains authored in ProductChapter.summary on the programme page. */
export function ChapterSummary({
  name,
  summary,
  showOutcome = true,
  expanded = false,
  progress,
}: Pick<ProductChapter, "name" | "summary"> & {
  readonly showOutcome?: boolean;
  readonly expanded?: boolean;
  readonly progress?: ReactNode;
}) {
  const [outcome, ...sections] = summary.trim().split(/\n\s*\n/u);
  if (outcome === undefined || outcome === "") return progress ?? null;
  const content = (
    <div className="course-chapter-content">
      {sections.map((section, index) => {
        const lines = section.split("\n").map((line) => line.trim());
        return lines.every((line) => line.startsWith("- ")) ? (
          <ul key={index}>
            {lines.map((line, itemIndex) => (
              <li key={itemIndex}>
                <ChapterTopic text={line.slice(2)} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>{section}</p>
        );
      })}
    </div>
  );
  return (
    <div className="course-chapter-summary">
      {showOutcome ? <p className="course-chapter-outcome">{outcome}</p> : null}
      {sections.length === 0 ? (
        progress
      ) : expanded ? (
        <>
          <p className="course-chapter-topics-label">Темы и практика</p>
          {content}
        </>
      ) : (
        <div className="course-chapter-disclosure">
          {progress}
          <details className="course-chapter-details">
            <summary>
              <span className="course-chapter-details-label">
                Темы и практика<span className="sr-only"> главы «{name}»</span>
              </span>
              <ChevronDown aria-hidden="true" />
            </summary>
            {!showOutcome ? (
              <p className="course-chapter-outcome">{outcome}</p>
            ) : null}
            {content}
          </details>
        </div>
      )}
    </div>
  );
}

/** Only a leading authored label is emphasized; all content stays escaped React text. */
function ChapterTopic({ text }: { readonly text: string }) {
  const label = /^\*\*([^*]+)\*\*\s*(.*)$/u.exec(text);
  return label === null ? (
    text
  ) : (
    <>
      <strong>{label[1]}</strong> {label[2]}
    </>
  );
}
