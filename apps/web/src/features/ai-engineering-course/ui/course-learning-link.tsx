import { ArrowRight } from "lucide-react";

import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import "./course-learning-link.css";

const filmActionLabel = {
  continue: "Продолжить обучение",
  "try-free": "Попробовать бесплатно",
} as const;

/**
 * Действие на анимации первого экрана страницы курса: участнику «Продолжить обучение», тому, кто
 * ещё не учится, приглашение попробовать бесплатно (#1647). Оба ведут в программу.
 */
export function CourseLearningLink({
  slug,
  intent = "continue",
}: {
  readonly slug: string;
  readonly intent?: keyof typeof filmActionLabel;
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
