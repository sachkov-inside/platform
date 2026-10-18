import { factAnnouncement } from "@/shared/api/fact-announcement";
const changed = factAnnouncement("inside.payment-links.changed");
export const announcePaymentLinkChange = changed.announce;
export const subscribePaymentLinkChange = changed.subscribe;
