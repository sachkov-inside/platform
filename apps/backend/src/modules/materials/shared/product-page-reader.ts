import { writeLog } from "../../../infrastructure/observability/index.js";
import {
  readStoredProductPage,
  type ProductPage,
} from "../domain/product-page.js";

/**
 * Описание страницы пишет только проверенный импорт, поэтому сохранённое значение, которое больше
 * не проходит схему, — это рассинхрон данных и выпуска: читателю его не показывают, а сервер
 * оставляет о нём запись для оператора (ADR 0026). Продукт без описания — обычный случай.
 */
export function readProductPage(
  value: unknown,
  context: string,
): ProductPage | null {
  return readProductPageState(value, context).page;
}

/** Нечитаемое описание отличают от отсутствующего: иначе перенос не может его заменить. */
export function readProductPageState(
  value: unknown,
  context: string,
): { readonly page: ProductPage | null; readonly rejected: boolean } {
  const page = readStoredProductPage(value);
  if (page !== "invalid") return { page, rejected: false };
  writeLog("warn", "stored_page_rejected", {
    area: "product_page",
    status: "operator_attention",
    reason: "stored_page_rejected",
    context,
  });
  return { page: null, rejected: true };
}
