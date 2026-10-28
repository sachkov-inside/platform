/**
 * Product Access в админке: причины выдачи, отзыва и восстановления и их кодирование в текст
 * истории. Ими пользуются выдача одному человеку (`@/features/product-access-actions`) и выдача
 * нескольким людям (`@/features/product-holders`).
 */
export {
  ACCESS_REASON_MAX_CHARACTERS,
  encodeAccessReason,
  encodeRestoreReason,
  grantReasons,
  otherReason,
  reasonNoteMaxCharacters,
  revokeReasons,
  type AccessReasonResult,
} from "./model/access-reasons";
