import { ChevronDown } from "lucide-react";

import type { ProductChapter } from "@/features/library-discovery";

import "./course-programme-overview.css";

/** Chapter copy remains authored in ProductChapter.summary, shared by both course surfaces. */
export function ChapterSummary({
  name,
  summary,
  showOutcome = true,
}: Pick<ProductChapter, "name" | "summary"> & {
  readonly showOutcome?: boolean;
}) {
  const [outcome, ...sections] = summary.trim().split(/\n\s*\n/u);
  if (outcome === undefined || outcome === "") return null;

  return (
    <div className="course-chapter-summary">
      {showOutcome ? <p className="course-chapter-outcome">{outcome}</p> : null}
      {sections.length === 0 ? null : (
        <details className="course-chapter-details">
          <summary>
            Темы и практика
            <span className="sr-only"> главы «{name}»</span>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div className="course-chapter-content">
            {sections.map((section, index) => {
              const lines = section.split("\n").map((line) => line.trim());
              return lines.every((line) => line.startsWith("- ")) ? (
                <ul key={index}>
                  {lines.map((line, itemIndex) => (
                    <li key={itemIndex}>{line.slice(2)}</li>
                  ))}
                </ul>
              ) : (
                <p key={index}>{section}</p>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

export function CourseProgrammeOverview({
  chapters,
}: {
  readonly chapters: readonly ProductChapter[];
}) {
  return (
    <section className="course-programme-overview" id="course-programme">
      <h2>Программа курса</h2>
      <ol className="course-programme-chapters">
        {chapters.map((chapter) => (
          <li key={chapter.id}>
            <h3>{chapter.name}</h3>
            <ChapterSummary
              name={chapter.name}
              summary={chapter.summary}
              showOutcome={chapter.materialIds.length === 0}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
