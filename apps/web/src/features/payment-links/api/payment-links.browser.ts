import {
  createOwnerPaymentLinkOperation,
  listOwnerPaymentLinksOperation,
  revokeOwnerPaymentLinkOperation,
} from "./payment-links.operation";

export const createPaymentLink = createOwnerPaymentLinkOperation.send;
export const revokePaymentLink = revokeOwnerPaymentLinkOperation.send;
export const listPaymentLinks = listOwnerPaymentLinksOperation.send;
