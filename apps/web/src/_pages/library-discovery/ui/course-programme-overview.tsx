import { ChevronDown } from "lucide-react";

import type { ProductChapter } from "@/features/library-discovery";

import { parseChapterSummary } from "./course-roadmap";
import { ChapterTopic } from "./course-roadmap-view";
import "./course-programme-overview.css";

/**
 * Темы и абзацы описания главы после её итога, свёрнутые в «Темы и практика». Итог главы окно главы
 * показывает в своей шапке, поэтому здесь его нет. Описание без тем ничего не рисует.
 */
export function ChapterSummary({
  name,
  summary,
}: Pick<ProductChapter, "name" | "summary">) {
  const { sections } = parseChapterSummary(summary);
  if (sections.length === 0) return null;
  return (
    <div className="course-chapter-summary">
      <details className="course-chapter-details">
        <summary>
          <span className="course-chapter-details-label">
            Темы и практика<span className="sr-only"> главы «{name}»</span>
          </span>
          <ChevronDown aria-hidden="true" />
        </summary>
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
      </details>
    </div>
  );
}
