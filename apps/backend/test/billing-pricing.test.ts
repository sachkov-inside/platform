import { toOpenApiSchema } from "../src/infrastructure/http/zod-openapi.js";
import { quotePurchaseSchema, priceQuoteSchema } from "../src/modules/billing/features/quote-purchase/quote-purchase.js";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { applicablePromotion, discountedPrice, moneySchema } from "../src/modules/billing/domain/pricing.js";
import { manageCatalogSchema } from "../src/modules/billing/features/manage-catalog/manage-catalog.contract.js";
import { throwPricingError } from "../src/modules/billing/shared/pricing-http.filter.js";

describe("Billing pricing rules", () => {
  test("OpenAPI preserves UUID and benefit types through normalization", () => {
    expect(toOpenApiSchema(quotePurchaseSchema)).toMatchObject({ properties: { operationId: { type: "string", format: "uuid" }, paymentOptionId: { type: "string", format: "uuid" } } });
    expect(toOpenApiSchema(priceQuoteSchema)).toMatchObject({ properties: { quoteRef: { type: "string", format: "uuid" }, snapshot: { properties: { offer: { properties: { benefits: { type: "array", items: { anyOf: [{ type: "string", enum: ["materials", "community", "reviews", "support"] }, { type: "string" }] } } } } } } } });
  });
  test("rounds half up exactly even at the safe-integer ceiling", () => {
    expect(discountedPrice(1, 50)).toBe(1);
    expect(discountedPrice(101, 50)).toBe(51);
    expect(discountedPrice(100_001, 25)).toBe(75_001);
    expect(discountedPrice(Number.MAX_SAFE_INTEGER, 1)).toBe(8_917_127_262_193_581);
    expect(discountedPrice(Number.MAX_SAFE_INTEGER, 0)).toBe(Number.MAX_SAFE_INTEGER);
    for (const amount of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) expect(moneySchema.safeParse(amount).success).toBe(false);
  });
  test("promotion uses a half-open instant interval, both scopes and exact trimmed code", () => {
    const option = { id: randomUUID(), offerId: randomUUID(), revision: 1, months: 5, priceKopecks: 1000, archived: false };
    const promotion = { id: randomUUID(), revision: 1, name: "Launch", percent: 10, code: "CODE", startsAt: "2026-09-08T15:00:00+03:00", endsAt: "2026-09-08T16:00:00+03:00", offerIds: [option.offerId], paymentOptionIds: [option.id], usageLimit: null, archived: false };
    expect(applicablePromotion(promotion, option, new Date("2026-09-08T12:00:00Z"), "CODE")).toBe(true);
    expect(applicablePromotion(promotion, option, new Date("2026-09-08T13:00:00Z"), "CODE")).toBe(false);
    expect(applicablePromotion(promotion, option, new Date("2026-09-08T11:59:59Z"), "CODE")).toBe(false);
    expect(applicablePromotion(promotion, option, new Date("2026-09-08T12:00:00Z"), "code")).toBe(false);
    expect(applicablePromotion(promotion, { ...option, offerId: randomUUID() }, new Date("2026-09-08T12:00:00Z"), "CODE")).toBe(false);
    expect(applicablePromotion({ ...promotion, archived: true }, option, new Date("2026-09-08T12:00:00Z"), "CODE")).toBe(false);
  });
  test("owner API rejects unknown operations and fields and requires archive revision", () => {
    expect(manageCatalogSchema.safeParse({ operation: "refunds.execute", operationId: randomUUID() }).success).toBe(false);
    expect(manageCatalogSchema.safeParse({ operation: "offers.archive", operationId: randomUUID(), id: randomUUID() }).success).toBe(false);
    expect(manageCatalogSchema.safeParse({ operation: "offers.save", operationId: randomUUID(), value: { id: randomUUID(), name: "Inside", benefits: ["materials", "materials"] } }).success).toBe(false);
  });
  test("maps price changes to visible conflict and unsupported amount to validation failure", () => {
    expect(() => throwPricingError({ code: "quote_changed" })).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => throwPricingError({ code: "unsupported_amount" })).toThrow(expect.objectContaining({ status: 422 }));
  });
});
