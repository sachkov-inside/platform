import { ArrowRight } from "lucide-react";

import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import "./course-learning-link.css";

/**
 * Действие на анимации первого экрана страницы курса: участнику «Продолжить обучение», тому, кто
 * ещё не учится, приглашение начать бесплатно (#1647). Оба ведут в программу.
 */
export function CourseLearningLink({
  slug,
  label = "Продолжить обучение",
}: {
  readonly slug: string;
  readonly label?: string;
}) {
  return (
    <div className="aie-learning-film">
      <IntentPrefetchLink
        className="aie-learning-link"
        href={productProgrammeHref(slug)}
      >
        {label}
        <ArrowRight aria-hidden="true" />
      </IntentPrefetchLink>
    </div>
  );
}
