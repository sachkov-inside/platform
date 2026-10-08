import { idSchema } from "./pricing.js";

/** Offer links resolve their covered product before entering its checkout page. */
export function offerCheckoutPath(offerId: string): string {
  return `/payment/checkout?${new URLSearchParams({ offer: idSchema.parse(offerId) }).toString()}`;
}
