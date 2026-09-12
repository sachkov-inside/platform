/**
 * Юридический документ Inside на сайте: порядок и названия в навигации, краткие сведения о
 * продавце и показ принятого текста. Сами редакции, их версии, даты действия и контрольные
 * суммы принадлежат пакету `@inside/legal`.
 */
export {
  LEGAL_GROUP_ORDER,
  LEGAL_GROUP_TITLES,
  LEGAL_NAVIGATION,
  legalNavigationEntry,
  type LegalGroup,
  type LegalNavigationEntry,
} from "./model/catalog";
export { LEGAL_SELLER } from "./model/seller";
export { legalEffectiveNote } from "./model/status";
export { LegalDocumentLinks } from "./ui/legal-document-links";
export { LegalDocumentView } from "./ui/legal-document-view";
