import "server-only";

import { ownerBillingCommand } from "@/entities/subscription.server";

import {
  archivePromotionOperation,
  listPromotionsOperation,
  readQuestionnaireRespondentsOperation,
  savePromotionOperation,
} from "./promotions.operation";

export function handleSavePromotion(request: Request): Promise<Response> {
  return ownerBillingCommand(request, savePromotionOperation, (input) => ({
    operation: "promotions.save",
    operationId: input.operationId,
    ...(input.expectedRevision === undefined
      ? {}
      : { expectedRevision: input.expectedRevision }),
    value: { ...input.value, productIds: [...input.value.productIds] },
  }));
}

export function handleArchivePromotion(request: Request): Promise<Response> {
  return ownerBillingCommand(request, archivePromotionOperation, (input) => ({
    ...input,
    operation: "promotions.archive",
  }));
}

export function handleListPromotions(request: Request): Promise<Response> {
  return ownerBillingCommand(request, listPromotionsOperation, (input) => ({
    operation: "promotions.list",
    operationId: input.operationId,
    limit: input.limit,
    archived: input.archived ?? false,
    questionnaire: input.questionnaire ?? false,
    ...(input.productId === undefined ? {} : { productId: input.productId }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
  }));
}

export function handleQuestionnaireRespondents(
  request: Request,
): Promise<Response> {
  return ownerBillingCommand(
    request,
    readQuestionnaireRespondentsOperation,
    (input) => ({ ...input, operation: "respondents.status" }),
  );
}
