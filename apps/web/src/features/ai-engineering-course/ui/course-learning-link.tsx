import type { Route } from "next";
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

/**
 * Действие на анимации первого экрана страницы курса: участнику «Продолжить обучение», тому, кто
 * ещё не учится, приглашение попробовать бесплатно в программе (#1647) или «Начать бесплатно» прямо
 * в первом уроке, когда он бесплатный.
 */
export function CourseLearningLink(
  props:
    | {
        readonly slug: string;
        readonly intent?: "continue" | "try-free" | "programme";
      }
    | {
        readonly slug: string;
        readonly intent: "start-free";
        /** Первый урок программы: «Начать бесплатно» ведёт прямо в него. */
        readonly lessonHref: Route;
      },
) {
  const intent = props.intent ?? "continue";
  return (
    <div className="aie-learning-film">
      <IntentPrefetchLink
        className="aie-learning-link"
        href={
          props.intent === "start-free"
            ? props.lessonHref
            : productProgrammeHref(props.slug)
        }
      >
        {filmActionLabel[intent]}
        <ArrowRight aria-hidden="true" />
      </IntentPrefetchLink>
    </div>
  );
}
