import type { MaterialPreview } from "@/entities/material";

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
