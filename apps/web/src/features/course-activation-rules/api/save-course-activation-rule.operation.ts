import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  activationRuleOutcomeSchema,
  saveActivationRuleInputSchema,
} from "../model/course-activation-rules";

/** Создание правила или смена его публикации: команда `activationRules.save` без изменений. */
export const saveCourseActivationRuleOperation = defineMutationOperation({
  input: saveActivationRuleInputSchema,
  method: "POST",
  path: "/api/authoring/billing/activation-rules/save",
  result: billingCommandResultSchema(activationRuleOutcomeSchema),
  transportFailure: billingTransportFailure,
});
