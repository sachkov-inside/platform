/**
 * Действия с доступом к продуктам в карточке человека (#1721): «Выдать продукт», «Отозвать» с
 * причиной и последствием, «Восстановить». Правила и исполнение принадлежат Product Access
 * (`@/entities/subscription`); фича только вызывает его операции и показывает ответ.
 */
export {
  useProductAccessActions,
  type AccessCardProduct,
  type ProductAccessActions,
  type ProductAccessActionsInput,
} from "./ui/use-product-access-actions.client";
export {
  GrantProductDialog,
  type GrantProductDialogProps,
  type HeldAccess,
} from "./ui/grant-product-dialog.client";
export {
  RestoreAccessDialog,
  type RestoreAccessDialogProps,
} from "./ui/restore-access-dialog.client";
export { useAccessChangeRefresh } from "./model/use-access-change-refresh.client";
export {
  useAccessProductCatalog,
  type AccessProductCatalogView,
} from "./model/use-access-product-catalog.client";
export {
  accessProductLabel,
  type AccessProduct,
  type AccessProductCatalog,
} from "./model/product-catalog";
export { revocationConsequence } from "./model/revocation-consequence";
