import type { Route } from "next";

import type { MaterialPreview } from "@/entities/material";
import type { ProgrammePlacement } from "@/features/library-discovery";
import {
  materialReaderHref,
  productReaderReturnHref,
} from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

/**
 * Открыт ли урок бесплатно: от этого зависит приглашение к нему. Гостю бесплатный урок курса
 * закрыт до входа через Telegram (#1825), но он остаётся бесплатным; не открыт он, только когда
 * доступ не удалось проверить.
 */
function isOpenFree(item: MaterialPreview): boolean {
  return item.access === "free" && item.availability !== "unavailable";
}

/** Сколько уроков продукта открыто бесплатно: от этого зависит приглашение к ним. */
export function countFreeLessons(items: readonly MaterialPreview[]): number {
  return items.filter(isOpenFree).length;
}

/**
 * Куда ведёт «Начать бесплатно» на первом экране курса: сразу в первый урок программы, если он
 * бесплатный. Без известного порядка программы или с закрытым первым уроком кнопка ведёт в программу.
 */
export function firstFreeLessonHref({
  slug,
  items,
  programmePlacements,
}: {
  readonly slug: string;
  readonly items: readonly MaterialPreview[];
  readonly programmePlacements: readonly ProgrammePlacement[] | undefined;
}): Route | undefined {
  const placement = programmePlacements?.[0];
  if (placement === undefined) return undefined;
  const lesson = items.find((item) => item.materialId === placement.materialId);
  if (lesson === undefined || !isOpenFree(lesson)) return undefined;
  // Возврат из урока ведёт в программу к этому уроку, как из онбординга (personal-product).
  return materialReaderHref(
    lesson.slug,
    productReaderReturnHref(productProgrammeHref(slug), 1, lesson.slug),
    { placementId: placement.id },
  );
}
