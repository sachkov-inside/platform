import { ArrowRight } from "lucide-react";

import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import "./course-learning-link.css";

const filmActionLabel = {
  programme: "Посмотреть программу",
  continue: "Продолжить обучение",
  "try-free": "Попробовать бесплатно",
  "start-free": "Начать бесплатно",
} as const;

/** Действие на анимации ведёт в программу курса. */
export function CourseLearningLink({
  intent = "continue",
  slug,
}: {
  readonly intent?: keyof typeof filmActionLabel;
  readonly slug: string;
}) {
  return (
    <div className="aie-learning-film">
      <IntentPrefetchLink
        className="aie-learning-link"
        href={productProgrammeHref(slug)}
      >
        {filmActionLabel[intent]}
        <ArrowRight aria-hidden="true" />
      </IntentPrefetchLink>
    </div>
  );
}
