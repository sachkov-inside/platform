import {
  isProductCapability,
  productIdFromCapability,
  productCapability,
} from "@inside/access-capabilities";
import type { PaymentLinkDetail, PriceSnapshot } from "@/entities/subscription";
import { productWithSupportOffer } from "./billing.fixtures";
export const individualLinkId = "69000000-0000-4000-8000-000000001450";
export const individualSnapshot: PriceSnapshot = {
  ...productWithSupportOffer,
  offer: {
    ...productWithSupportOffer.offer,
    name: "AI Engineering",
    benefits: [...productWithSupportOffer.offer.benefits, "community"],
    benefitPeriods: [
      ...(productWithSupportOffer.offer.benefitPeriods ?? []),
      { capability: "community", months: null },
    ],
  },
  firstPriceKopecks: 2610000,
  paymentOption: {
    ...productWithSupportOffer.paymentOption,
    priceKopecks: 2900000,
  },
  individualPayment: { linkId: individualLinkId, basePriceKopecks: 2900000 },
};
export const individualLink: PaymentLinkDetail = {
  id: individualLinkId,
  revision: 1,
  state: "active",
  createdAt: "2026-10-15T10:00:00Z",
  expiresAt: null,
  snapshot: individualSnapshot,
  product: {
    id:
      productIdFromCapability(
        productWithSupportOffer.offer.benefits.find(isProductCapability) ??
          productCapability("69000000-0000-4000-8000-000000000001"),
      ) ?? "69000000-0000-4000-8000-000000000001",
    kind: "product",
    title: "AI Engineering",
    slug: "ai-engineering",
    available: true,
  },
};
