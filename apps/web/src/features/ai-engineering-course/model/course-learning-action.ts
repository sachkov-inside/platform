import type { Route } from "next";

import { productProgrammeHref } from "@/shared/routing/subscription-route";

/** Действие участника: вход в программу курса с текущим прогрессом. */
export function courseLearningAction(
  slug: string,
  continuationMaterialSlug: string | null = null,
): {
  readonly kind: "programme";
  readonly href: Route;
  readonly label: string;
} {
  const programme = productProgrammeHref(slug);
  return {
    kind: "programme",
    href: programme,
    label:
      continuationMaterialSlug === null
        ? "Открыть программу"
        : "Продолжить обучение",
  };
}
