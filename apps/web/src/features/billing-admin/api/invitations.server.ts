import "server-only";
import {
  invitationOutcomeSchema,
  invitationsOutcomeSchema,
  issueInvitationInputSchema,
  listInvitationsInputSchema,
  revokeInvitationInputSchema,
  revokedInvitationOutcomeSchema,
} from "../model/invitation-operations";
import { ownerCommand } from "./billing-admin.server";

export function handleIssueInvitation(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    issueInvitationInputSchema,
    invitationOutcomeSchema,
    (input) => {
      const note = input.note?.trim() ?? "";
      return {
        operation: "invitations.issue",
        operationId: input.operationId,
        offerId: input.offerId,
        mode: input.mode,
        // Срок принадлежит только подарку: у оплаты его задаёт вариант оплаты.
        giftMonths: input.mode === "gift" ? (input.giftMonths ?? null) : null,
        note: note.length === 0 ? null : note,
      };
    },
  );
}

export function handleRevokeInvitation(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    revokeInvitationInputSchema,
    revokedInvitationOutcomeSchema,
    (input) => ({ ...input, operation: "invitations.revoke" }),
  );
}

export function handleListInvitations(request: Request): Promise<Response> {
  return ownerCommand(
    request,
    listInvitationsInputSchema,
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
