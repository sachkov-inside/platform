import type { MaterialDraftPresentation } from "./presentation";

/**
 * Лента публичная: в неё попадает только бесплатный материал вне курсов (#1885). Урок курса
 * закрыт гостю до входа через Telegram (ADR 0042), поэтому в ленте его нет.
 */
export function canPlaceInFeed(
  draft: Pick<MaterialDraftPresentation, "access" | "productIds">,
): boolean {
  return draft.access === "free" && draft.productIds.length === 0;
}
