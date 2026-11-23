import type { Route } from "next";
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
 * ещё не учится, приглашение попробовать бесплатно (#1647). Если известен первый бесплатный урок, открываем его сразу.
 */
export function CourseLearningLink({
  slug,
  intent = "continue",
  firstLessonHref,
}: {
  readonly slug: string;
  readonly firstLessonHref?: Route | undefined;
  readonly intent?: keyof typeof filmActionLabel;
}) {
  return (
    <div className="aie-learning-film">
      <IntentPrefetchLink
        className="aie-learning-link"
        href={firstLessonHref ?? productProgrammeHref(slug)}
      >
        {firstLessonHref === undefined
          ? filmActionLabel[intent]
          : "Начать бесплатно"}
        <ArrowRight aria-hidden="true" />
      </IntentPrefetchLink>
    </div>
  );
}
