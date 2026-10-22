import {
  issueInvitationOperation,
  revokeInvitationOperation,
  listInvitationsOperation,
} from "./invitations.operation";

export const issueInvitation = issueInvitationOperation.send;

export const revokeInvitation = revokeInvitationOperation.send;

export const listInvitations = listInvitationsOperation.send;
