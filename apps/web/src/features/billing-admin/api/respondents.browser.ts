import type { z } from "zod";
import {
  billingCommandPayload,
  billingCommandResult,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  type importRespondentsInputSchema,
  type issueRespondentLinkInputSchema,
  respondentImportOutcomeSchema,
  respondentLinkOutcomeSchema,
  respondentsOutcomeSchema,
  type respondentsStatusInputSchema,
} from "../model/respondent-operations";

export async function importRespondents(
  input: z.infer<typeof importRespondentsInputSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/respondents/import",
      "POST",
      billingCommandPayload(input),
    ),
    respondentImportOutcomeSchema,
  );
}

export async function issueRespondentLink(
  input: z.infer<typeof issueRespondentLinkInputSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/respondents/issue",
      "POST",
      billingCommandPayload(input),
    ),
    respondentLinkOutcomeSchema,
  );
}

export async function respondentsStatus(
  input: z.infer<typeof respondentsStatusInputSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/respondents/status",
      "POST",
      billingCommandPayload(input),
    ),
    respondentsOutcomeSchema,
  );
}
