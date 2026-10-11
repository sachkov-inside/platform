import type { Route } from "next";

import { materialReaderHref } from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

/** Действие участника: первый вход в программу или продолжение открытого урока. */
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
    href:
      continuationMaterialSlug === null
        ? programme
        : materialReaderHref(continuationMaterialSlug, programme),
    label:
      continuationMaterialSlug === null
        ? "Открыть программу"
        : "Продолжить обучение",
  };
}
