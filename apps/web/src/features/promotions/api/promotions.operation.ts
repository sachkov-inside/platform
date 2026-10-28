import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  archivePromotionInputSchema,
  listPromotionsInputSchema,
  promotionCatalogOutcomeSchema,
  promotionsOutcomeSchema,
  respondentsOutcomeSchema,
  respondentsStatusInputSchema,
  savePromotionInputSchema,
} from "../model/promotion-operations";

/** `promotions.save`: создание или изменение скидки с редакцией из списка. */
export const savePromotionOperation = defineMutationOperation({
  input: savePromotionInputSchema,
  method: "POST",
  path: "/api/authoring/billing/promotions/save",
  result: billingCommandResultSchema(promotionCatalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});

/** `promotions.archive` с ожидаемой редакцией. */
export const archivePromotionOperation = defineMutationOperation({
  input: archivePromotionInputSchema,
  method: "POST",
  path: "/api/authoring/billing/promotions/archive",
  result: billingCommandResultSchema(promotionCatalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});

/** `promotions.list`: страница скидок владельца с фильтром продукта, архива и анкеты. */
export const listPromotionsOperation = defineMutationOperation({
  input: listPromotionsInputSchema,
  method: "POST",
  path: "/api/authoring/billing/promotions/list",
  result: billingCommandResultSchema(promotionsOutcomeSchema),
  transportFailure: billingTransportFailure,
});

/** `respondents.status`: сводка анкетных скидок только для чтения. */
export const readQuestionnaireRespondentsOperation = defineMutationOperation({
  input: respondentsStatusInputSchema,
  method: "POST",
  path: "/api/authoring/billing/respondents/status",
  result: billingCommandResultSchema(respondentsOutcomeSchema),
  transportFailure: billingTransportFailure,
});
