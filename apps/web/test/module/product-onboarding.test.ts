import { expect, test } from "vitest";
import { productCapability } from "@inside/access-capabilities";
import { hasPaidProductAccess } from "@/_pages/library-discovery/model/product-onboarding";
import type { AccessGround } from "@/entities/subscription";
const product = "10000000-0000-4000-8000-000000000001";
const ground: AccessGround = {
  source: "paid",
  capabilities: [productCapability(product)],
  startsAt: "2026-01-01T00:00:00.000Z",
  validUntil: null,
  active: true,
};
test("course onboarding requires active paid coverage for this Product", () => {
  expect(hasPaidProductAccess([], product)).toBe(false);
  expect(hasPaidProductAccess([ground], product)).toBe(true);
  expect(
    hasPaidProductAccess([{ ...ground, capabilities: ["materials"] }], product),
  ).toBe(false);
  expect(hasPaidProductAccess([{ ...ground, active: false }], product)).toBe(
    false,
  );
  expect(hasPaidProductAccess([{ ...ground, source: "manual" }], product)).toBe(
    false,
  );
  expect(hasPaidProductAccess([{ ...ground, source: "legacy" }], product)).toBe(
    false,
  );
  expect(
    hasPaidProductAccess([{ ...ground, capabilities: ["community"] }], product),
  ).toBe(false);
  expect(
    hasPaidProductAccess([ground], "10000000-0000-4000-8000-000000000002"),
  ).toBe(false);
});
