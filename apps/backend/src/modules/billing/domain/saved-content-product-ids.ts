import {
  isProductCapability,
  productIdFromCapability,
} from "@inside/access-capabilities";
import type { PriceSnapshot } from "./pricing.js";

/** Only immutable content authority names Products. Support/community coverage does not. */
export function savedContentProductIds(snapshot: PriceSnapshot): string[] {
  return [
    ...new Set(
      [
        ...snapshot.offer.benefits
          .filter(isProductCapability)
          .map(productIdFromCapability)
          .filter((id): id is string => id !== null),
        ...(snapshot.offer.benefits.includes("materials")
          ? (snapshot.offer.coverage?.productIds ?? [])
          : []),
      ].map((id) => id.toLowerCase()),
    ),
  ].sort();
}
