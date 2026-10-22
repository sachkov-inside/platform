import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  invitationOutcomeSchema,
  invitationsOutcomeSchema,
  issueInvitationInputSchema,
  listInvitationsInputSchema,
  revokeInvitationInputSchema,
  revokedInvitationOutcomeSchema,
} from "../model/invitation-operations";

export const issueInvitationOperation = defineMutationOperation({
  input: issueInvitationInputSchema,
  method: "POST",
  path: "/api/authoring/billing/invitations/issue",
  result: billingCommandResultSchema(invitationOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const revokeInvitationOperation = defineMutationOperation({
  input: revokeInvitationInputSchema,
  method: "POST",
  path: "/api/authoring/billing/invitations/revoke",
  result: billingCommandResultSchema(revokedInvitationOutcomeSchema),
  transportFailure: billingTransportFailure,
});

export const listInvitationsOperation = defineMutationOperation({
  input: listInvitationsInputSchema,
  method: "POST",
  path: "/api/authoring/billing/invitations/list",
  result: billingCommandResultSchema(invitationsOutcomeSchema),
  transportFailure: billingTransportFailure,
});
