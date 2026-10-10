/**
 * Узкий серверный вход для страницы урока: она читает режим, но не обслуживает запись, поэтому
 * не тянет за собой BFF и его зависимость от провайдера входа.
 */
export {
  loadReaderProductMode,
  readerHasSeenProductModeHint,
} from "./product-modes/api/product-mode.server";
