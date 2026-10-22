import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  accessSummaryInputSchema,
  accessSummaryOutcomeSchema,
  listPeopleInputSchema,
  peopleOutcomeSchema,
} from "../model/access-operations";

export const listPeopleOperation = defineMutationOperation({
  input: listPeopleInputSchema,
  method: "POST",
  path: "/api/authoring/billing/people/list",
  result: billingCommandResultSchema(peopleOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const readAccessSummaryOperation = defineMutationOperation({
  input: accessSummaryInputSchema,
  method: "POST",
  path: "/api/authoring/billing/access-summary",
  result: billingCommandResultSchema(accessSummaryOutcomeSchema),
  transportFailure: billingTransportFailure,
});
