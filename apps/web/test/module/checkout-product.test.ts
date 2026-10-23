import { expect, it } from "vitest";
import { productWithSupportOffer } from "@/storybook/billing.fixtures";
import { productIdFromCapability } from "@inside/access-capabilities";
import { checkoutProductSlug } from "@/_pages/subscription/model/checkout-product";

const id = productIdFromCapability(
  productWithSupportOffer.offer.benefits[0] ?? "materials",
);
const products = [
  { id: "other-product", slug: "other" },
  { id: id ?? "", slug: "inside-course" },
];

it("resolves the selected Product price to its actual Product", () => {
  expect(
    checkoutProductSlug(
      products,
      [productWithSupportOffer],
      productWithSupportOffer.product?.id,
    ),
  ).toBe("inside-course");
  expect(
    checkoutProductSlug(
      products.slice(0, 1),
      [productWithSupportOffer],
      productWithSupportOffer.product?.id,
    ),
  ).toBeUndefined();
});

it("does not grant a whole-platform tariff authority and tolerates an empty catalog", () => {
  const offer = {
    ...productWithSupportOffer,
    offer: {
      ...productWithSupportOffer.offer,
      benefits: ["materials" as const],
      coverage: {
        productIds: [],
        materialIds: [],
        wholePlatform: true as const,
      },
    },
  };
  expect(checkoutProductSlug(products, [offer], offer.product?.id)).toBe(
    "inside-course",
  );
  expect(checkoutProductSlug([], [offer], offer.product?.id)).toBeUndefined();
});

it("does not substitute another product when the chosen tariff is hidden or unavailable", () => {
  expect(
    checkoutProductSlug(products, [], productWithSupportOffer.product?.id),
  ).toBeUndefined();
});
