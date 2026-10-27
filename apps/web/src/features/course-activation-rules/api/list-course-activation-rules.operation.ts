import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  activationRulesOutcomeSchema,
  listActivationRulesInputSchema,
} from "../model/course-activation-rules";

/** Владельческое чтение правил активации: тот же маршрут, что и у прежнего раздела продаж. */
export const listCourseActivationRulesOperation = defineMutationOperation({
  input: listActivationRulesInputSchema,
  method: "POST",
  path: "/api/authoring/billing/activation-rules/list",
  result: billingCommandResultSchema(activationRulesOutcomeSchema),
  transportFailure: billingTransportFailure,
});
