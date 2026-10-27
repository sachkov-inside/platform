import { expect, it } from "vitest";
import { quoteInputSchema } from "@/features/billing-checkout/model/checkout";

it("quotes the selected Product price and rejects removed payment-option commands", () => {
  const operationId = "20000000-0000-4000-8000-000000000001";
  const productId = "20000000-0000-4000-8000-000000000002";
  expect(
    quoteInputSchema.safeParse({ operationId, productId, priceRevision: 3 })
      .success,
  ).toBe(true);
  expect(
    quoteInputSchema.safeParse({
      operationId,
      paymentOptionId: productId,
      optionRevision: 3,
    }).success,
  ).toBe(false);
});
