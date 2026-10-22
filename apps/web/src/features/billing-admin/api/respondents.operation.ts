import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  importRespondentsInputSchema,
  issueRespondentLinkInputSchema,
  respondentImportOutcomeSchema,
  respondentLinkOutcomeSchema,
  respondentsOutcomeSchema,
  respondentsStatusInputSchema,
} from "../model/respondent-operations";

export const importRespondentsOperation = defineMutationOperation({
  input: importRespondentsInputSchema,
  method: "POST",
  path: "/api/authoring/billing/respondents/import",
  result: billingCommandResultSchema(respondentImportOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const issueRespondentLinkOperation = defineMutationOperation({
  input: issueRespondentLinkInputSchema,
  method: "POST",
  path: "/api/authoring/billing/respondents/issue",
  result: billingCommandResultSchema(respondentLinkOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const respondentsStatusOperation = defineMutationOperation({
  input: respondentsStatusInputSchema,
  method: "POST",
  path: "/api/authoring/billing/respondents/status",
  result: billingCommandResultSchema(respondentsOutcomeSchema),
  transportFailure: billingTransportFailure,
});
