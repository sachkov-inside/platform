import { factAnnouncement } from "@/shared/api/fact-announcement";

const invitationChanged = factAnnouncement("inside.invitations.changed");
export const announceInvitationChange = invitationChanged.announce;
export const subscribeInvitationChange = invitationChanged.subscribe;
