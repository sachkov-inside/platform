import type { MaterialPreview } from "@/entities/material";
import type { ProgrammePlacement } from "@/features/library-discovery";

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

/** Первый урок программы доступен для бесплатного старта. */
export function hasFreeFirstLesson(
  items: readonly MaterialPreview[],
  placements: readonly ProgrammePlacement[] | undefined,
): boolean {
  const first = placements?.[0];
  return (
    first !== undefined &&
    items.some(
      (item) => item.materialId === first.materialId && isOpenFree(item),
    )
  );
}
