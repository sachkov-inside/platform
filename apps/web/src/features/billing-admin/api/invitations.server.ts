import "server-only";
import {
  issueInvitationOperation,
  listInvitationsOperation,
  revokeInvitationOperation,
} from "./invitations.operation";
import {
  invitationOutcomeSchema,
  invitationsOutcomeSchema,
  revokedInvitationOutcomeSchema,
} from "../model/invitation-operations";
import { ownerCommand } from "./billing-admin.server";

export function handleIssueInvitation(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    issueInvitationOperation,
    invitationOutcomeSchema,
    (input) => {
      const note = input.note?.trim() ?? "";
      return {
        operation: "invitations.issue",
        operationId: input.operationId,
        offerId: input.offerId,
        mode: input.mode,
        note: note.length === 0 ? null : note,
      };
    },
  );
}

export function handleRevokeInvitation(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    revokeInvitationOperation,
    revokedInvitationOutcomeSchema,
    (input) => ({ ...input, operation: "invitations.revoke" }),
  );
}

export function handleListInvitations(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    listInvitationsOperation,
    invitationsOutcomeSchema,
    (input) => ({
      operation: "invitations.list",
      operationId: input.operationId,
      limit: input.limit,
      ...(input.state === undefined ? {} : { state: input.state }),
      ...(input.offerId === undefined ? {} : { offerId: input.offerId }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    }),
  );
}
