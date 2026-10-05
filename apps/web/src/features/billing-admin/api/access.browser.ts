import {
  billingCommandPayload,
  billingCommandResult,
  type BillingCommandResult,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  accessSummaryOutcomeSchema,
  peopleOutcomeSchema,
  type AccessSummaryInput,
  type AccessSummaryOutcome,
  type ListPeopleInput,
  type PeopleOutcome,
} from "../model/access-operations";

export async function listPeople(
  input: ListPeopleInput,
): Promise<BillingCommandResult<PeopleOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/people/list",
      "POST",
      billingCommandPayload(input),
    ),
    peopleOutcomeSchema,
  );
}

export async function readAccessSummary(
  input: AccessSummaryInput,
): Promise<BillingCommandResult<AccessSummaryOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/access-summary",
      "POST",
      billingCommandPayload(input),
    ),
    accessSummaryOutcomeSchema,
  );
}
