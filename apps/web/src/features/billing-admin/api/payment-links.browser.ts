import {
  createPaymentLinkOperation,
  revokePaymentLinkOperation,
  listPaymentLinksOperation,
} from "./payment-links.operation";
export const createPaymentLink = createPaymentLinkOperation.send;
export const revokePaymentLink = revokePaymentLinkOperation.send;
export const listPaymentLinks = listPaymentLinksOperation.send;
