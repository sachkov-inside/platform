import type { MaterialPreview } from "@/entities/material";

/**
 * Сколько уроков продукта открыто бесплатно: от этого зависят приглашения к ним. Гостю бесплатный
 * урок курса закрыт до входа через Telegram (#1825), но он остаётся бесплатным; не считается он,
 * только когда доступ не удалось проверить.
 */
export function countFreeLessons(items: readonly MaterialPreview[]): number {
  return items.filter(
    (item) => item.access === "free" && item.availability !== "unavailable",
  ).length;
}
