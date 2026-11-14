import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import type { ProductChapter } from "@/features/library-discovery";

import { parseChapterSummary } from "./course-roadmap";
import { ChapterTopic } from "./course-roadmap-view";
import "./course-programme-overview.css";

/** Chapter copy remains authored in ProductChapter.summary on the programme page. */
export function ChapterSummary({
  name,
  summary,
  showOutcome = true,
  progress,
}: Pick<ProductChapter, "name" | "summary"> & {
  readonly showOutcome?: boolean;
  readonly progress?: ReactNode;
}) {
  const { outcome, sections } = parseChapterSummary(summary);
  if (outcome === "") return progress ?? null;
  const content = (
    <div className="course-chapter-content">
      {sections.map((section, index) =>
        section.kind === "topics" ? (
          <ul key={index}>
            {section.topics.map((topic, itemIndex) => (
              <li key={itemIndex}>
                <ChapterTopic text={topic} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>{section.text}</p>
        ),
      )}
    </div>
  );
  return (
    <div className="course-chapter-summary">
      {showOutcome ? <p className="course-chapter-outcome">{outcome}</p> : null}
      {sections.length === 0 ? (
        progress
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
