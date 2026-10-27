import { factAnnouncement } from "@/shared/api/fact-announcement";

/** Ссылки на оплату изменились: каждая открытая поверхность перечитывает свой список. */
const changed = factAnnouncement("inside.payment-links.changed");
export const announcePaymentLinkChange = changed.announce;
export const subscribePaymentLinkChange = changed.subscribe;
