import { ArrowRight } from "lucide-react";

import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import "./course-learning-link.css";

/** Сохраняет место личного действия, пока сервер проверяет доступ. */
export function CourseLearningPending() {
  return <div className="aie-learning-pending" aria-busy="true" />;
}

/** Действие участника на анимации и в нижнем блоке страницы курса. */
export function CourseLearningLink({
  slug,
  placement,
}: {
  readonly slug: string;
  readonly placement: "film" | "status";
}) {
  return (
    <div className={`aie-learning-${placement}`}>
      <IntentPrefetchLink
        className="aie-learning-link"
        href={productProgrammeHref(slug)}
      >
        Продолжить обучение
        <ArrowRight aria-hidden="true" />
      </IntentPrefetchLink>
    </div>
  );
}
