/**
 * Юридический документ Inside в интерфейсе: порядок и названия в навигации, отметка о начале
 * действия и ссылки на документы рядом с формами. Показ самого текста принадлежит странице
 * раздела, а редакции, их версии и контрольные суммы — пакету `@inside/legal`.
 */
export {
  LEGAL_GROUP_ORDER,
  LEGAL_GROUP_TITLES,
  LEGAL_NAVIGATION,
  legalNavigationEntry,
  type LegalGroup,
  type LegalNavigationEntry,
} from "./model/catalog";
export { legalEffectiveDate, legalEffectiveNote } from "./model/status";
export { LegalDocumentLinks } from "./ui/legal-document-links";
