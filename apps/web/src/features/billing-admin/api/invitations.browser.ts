import {
  billingCommandPayload,
  billingCommandResult,
  type BillingCommandResult,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  invitationOutcomeSchema,
  invitationsOutcomeSchema,
  type InvitationOutcome,
  type InvitationsOutcome,
  type IssueInvitationInput,
  type ListInvitationsInput,
  type RevokeInvitationInput,
  type RevokedInvitationOutcome,
  revokedInvitationOutcomeSchema,
} from "../model/invitation-operations";

export async function issueInvitation(
  input: IssueInvitationInput,
): Promise<BillingCommandResult<InvitationOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/invitations/issue",
      "POST",
      billingCommandPayload(input),
    ),
    invitationOutcomeSchema,
  );
}

export async function revokeInvitation(
  input: RevokeInvitationInput,
): Promise<BillingCommandResult<RevokedInvitationOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/invitations/revoke",
      "POST",
      billingCommandPayload(input),
    ),
    revokedInvitationOutcomeSchema,
  );
}

export async function listInvitations(
  input: ListInvitationsInput,
): Promise<BillingCommandResult<InvitationsOutcome>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/billing/invitations/list",
      "POST",
      billingCommandPayload(input),
    ),
    invitationsOutcomeSchema,
  );
}
