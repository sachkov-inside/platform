import { expect, it } from "vitest";

import type { PaymentLink } from "@/entities/subscription";
import {
  canRevokePaymentLink,
  paymentLinkClosed,
} from "@/features/payment-links/model/payment-links-presentation";
import { storyPaymentLinks } from "@/storybook/sales-catalog.fixtures";

it.each([
  ["active", true, false],
  ["changed", true, true],
  ["pending", false, false],
  ["unknown", false, false],
  ["paid", false, true],
  ["revoked", false, true],
  ["expired", false, true],
] satisfies readonly [PaymentLink["state"], boolean, boolean][])(
  "%s keeps revocation availability separate from the closed-sale explanation",
  (state, revocable, closed) => {
    const fixture = storyPaymentLinks(1)[0];
    if (fixture === undefined)
      throw new Error("Payment Link fixture is required");
    const link: PaymentLink = { ...fixture, state };
    expect(canRevokePaymentLink(link)).toBe(revocable);
    expect(paymentLinkClosed(link)).toBe(closed);
  },
);
