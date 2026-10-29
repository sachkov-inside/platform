import type { Route } from "next";

import type { MaterialPreview } from "@/entities/material";
import { materialReaderHref } from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";

/** Открыт ли урок бесплатно прямо сейчас: от этого зависит приглашение к нему. */
function isOpenFree(item: MaterialPreview): boolean {
  return item.access === "free" && item.availability === "available";
}

/** Сколько уроков продукта открыто бесплатно прямо сейчас: от этого зависит приглашение к ним. */
export function countFreeLessons(items: readonly MaterialPreview[]): number {
  return items.filter(isOpenFree).length;
}

export interface FreeLesson {
  readonly slug: string;
  readonly title: string;
  readonly href: Route;
}

/**
 * Бесплатные уроки курса в порядке программы. Урок открывается внутри программы, поэтому из него
 * идёт навигация по шагам курса, а возврат ведёт в программу (#1647).
 */
export function freeLessons({
  slug,
  items,
  chapters,
}: {
  readonly slug: string;
  readonly items: readonly MaterialPreview[];
  readonly chapters: readonly { readonly materialIds: readonly string[] }[];
}): readonly FreeLesson[] {
  const order = chapters.flatMap((chapter) => chapter.materialIds);
  const position = (item: MaterialPreview) => {
    const index =
      item.materialId === undefined ? -1 : order.indexOf(item.materialId);
    return index === -1 ? order.length : index;
  };
  const programme = productProgrammeHref(slug);
  // Сортировка устойчива: уроки вне глав сохраняют порядок состава после уроков глав.
  return items
    .filter(isOpenFree)
    .sort((left, right) => position(left) - position(right))
    .map((item) => ({
      slug: item.slug,
      title: item.title,
      href: materialReaderHref(item.slug, programme),
    }));
}
