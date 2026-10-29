import type { MaterialPreview } from "@/entities/material";

/**
 * Бесплатный урок, который читатель откроет без покупки: сразу или после входа через Telegram
 * (`locked` у гостя и у аккаунта без Telegram, #1825). Недоступный бесплатным не считается.
 */
export function isFreeLesson(item: MaterialPreview): boolean {
  return item.access === "free" && item.availability !== "unavailable";
}

/** Сколько уроков продукта бесплатны для читателя: от этого зависит приглашение к ним. */
export function countFreeLessons(items: readonly MaterialPreview[]): number {
  return items.filter(isFreeLesson).length;
}

/** Бесплатный урок, который откроется только после входа через Telegram. */
export function needsTelegramSignIn(item: MaterialPreview): boolean {
  return item.access === "free" && item.availability === "locked";
}
