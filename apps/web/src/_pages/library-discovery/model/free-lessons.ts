import type { MaterialPreview } from "@/entities/material";

/** Сколько уроков продукта открыто бесплатно прямо сейчас: от этого зависит приглашение к ним. */
export function countFreeLessons(items: readonly MaterialPreview[]): number {
  return items.filter(
    (item) => item.access === "free" && item.availability === "available",
  ).length;
}
