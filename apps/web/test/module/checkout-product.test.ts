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

it("resolves the selected tariff to its covered product rather than the first catalog entry", () => {
  expect(
    checkoutProductSlug(
      products,
      [productWithSupportOffer],
      productWithSupportOffer.offer.id,
    ),
  ).toBe("inside-course");
  expect(
    checkoutProductSlug(
      products.slice(0, 1),
      [productWithSupportOffer],
      productWithSupportOffer.offer.id,
    ),
  ).toBeUndefined();
});

it("opens whole-platform tariffs through a published product and tolerates an empty catalog", () => {
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
  expect(checkoutProductSlug(products, [offer], offer.offer.id)).toBe("other");
  expect(checkoutProductSlug([], [offer], offer.offer.id)).toBeUndefined();
});
