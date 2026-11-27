import { expect, it } from "vitest";
import { paymentLinkRegularPrice } from "@/entities/subscription";
import { productWithSupportOffer } from "../fixtures/billing.fixtures";
import { individualSnapshot } from "../fixtures/payment-links.fixtures";

it("shows the full price beside a discounted Payment Link price only", () => {
  expect(paymentLinkRegularPrice(individualSnapshot)).toBe(2_900_000);
  expect(
    paymentLinkRegularPrice({
      ...individualSnapshot,
      firstPriceKopecks: 2_900_000,
    }),
  ).toBeNull();
  expect(paymentLinkRegularPrice(productWithSupportOffer)).toBeNull();
});
