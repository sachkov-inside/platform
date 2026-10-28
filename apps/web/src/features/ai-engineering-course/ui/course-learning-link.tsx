import { ArrowRight } from "lucide-react";

import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";

import "./course-learning-link.css";

/** Действие участника на анимации первого экрана страницы курса. */
export function CourseLearningLink({ slug }: { readonly slug: string }) {
  return (
    <div className="aie-learning-film">
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
