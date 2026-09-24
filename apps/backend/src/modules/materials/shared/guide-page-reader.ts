import { writeLog } from "../../../infrastructure/observability/index.js";
import { readStoredGuidePage, type GuidePage } from "../domain/guide-page.js";

/**
 * Описание страницы пишет только проверенный импорт, поэтому сохранённое значение, которое больше
 * не проходит схему, — это рассинхрон данных и выпуска: читателю его не показывают, а сервер
 * оставляет о нём запись для оператора (ADR 0026). Продукт без описания — обычный случай.
 */
export function readGuidePage(value: unknown, context: string): GuidePage | null {
  return readGuidePageState(value, context).page;
}

/** Нечитаемое описание отличают от отсутствующего: иначе перенос не может его заменить. */
export function readGuidePageState(value: unknown, context: string): { readonly page: GuidePage | null; readonly rejected: boolean } {
  const page = readStoredGuidePage(value);
  if (page !== "invalid") return { page, rejected: false };
  writeLog("warn", "stored_page_rejected", { area: "guide_page", status: "operator_attention", context });
  return { page: null, rejected: true };
}
