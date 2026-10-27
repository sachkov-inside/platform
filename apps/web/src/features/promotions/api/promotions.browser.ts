import {
  archivePromotionOperation,
  listPromotionsOperation,
  readQuestionnaireRespondentsOperation,
  savePromotionOperation,
} from "./promotions.operation";

export const savePromotion = savePromotionOperation.send;
export const archivePromotion = archivePromotionOperation.send;
export const listPromotions = listPromotionsOperation.send;
export const readQuestionnaireRespondents =
  readQuestionnaireRespondentsOperation.send;
