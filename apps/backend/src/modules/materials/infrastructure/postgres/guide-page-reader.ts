import { readStoredGuidePage, type GuidePage } from "../../domain/guide-page.js";

/**
 * Описание страницы пишет только проверенный импорт, поэтому сохранённое значение, которое больше
 * не проходит схему, — это рассинхрон данных и выпуска: читателю его не показывают, а сервер
 * оставляет о нём запись в журнале (ADR 0026).
 */
export function readGuidePageForReader(value: unknown, context: string): GuidePage | null {
  const page = readStoredGuidePage(value);
  if (page !== "invalid") return page;
  console.warn(`[guide-page] ${context}: the stored product page description no longer matches this release; it is not shown`);
  return null;
}
