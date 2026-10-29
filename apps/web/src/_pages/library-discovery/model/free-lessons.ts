import type { Route } from "next";

import type { MaterialPreview } from "@/entities/material";
import { materialReaderHref } from "@/shared/routing/material-reader";
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

export interface FreeLesson {
  readonly slug: string;
  readonly title: string;
  readonly href: Route;
}

/**
 * Бесплатные уроки курса в порядке программы. Порядок задают размещения программы, а без них главы;
 * дополнительные материалы глав уроками не считаются. Урок открывается внутри программы, поэтому из
 * него идёт навигация по шагам курса, а возврат ведёт в программу (#1647).
 */
export function freeLessons({
  slug,
  items,
  chapters,
  programmePlacements,
}: {
  readonly slug: string;
  readonly items: readonly MaterialPreview[];
  readonly chapters: readonly { readonly materialIds: readonly string[] }[];
  readonly programmePlacements?:
    readonly { readonly materialId: string }[] | undefined;
}): readonly FreeLesson[] {
  const order =
    programmePlacements?.map(({ materialId }) => materialId) ??
    chapters.flatMap((chapter) => chapter.materialIds);
  const position = (item: MaterialPreview) =>
    item.materialId === undefined ? -1 : order.indexOf(item.materialId);
  const programme = productProgrammeHref(slug);
  // Продукт без глав показывает весь состав по порядку; иначе в список идут только уроки маршрута.
  return items
    .filter(
      (item) => isOpenFree(item) && (order.length === 0 || position(item) >= 0),
    )
    .sort((left, right) => position(left) - position(right))
    .map((item) => ({
      slug: item.slug,
      title: item.title,
      href: materialReaderHref(item.slug, programme),
    }));
}
