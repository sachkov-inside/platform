import { describe, expect, it } from "vitest";
import { accountProducts } from "@/features/billing-subscription/model/account-products";
import {
  cabinetProduct,
  cabinetProductGround as ground,
  cabinetProductPayment as payment,
} from "@/storybook/billing.fixtures";

describe("one cabinet card per product", () => {
  it("joins current access and purchase, retaining all historical purchases", () => {
    const failed = {
      ...payment,
      purchaseRef: "new",
      createdAt: "2026-10-01T00:00:00Z",
      state: "failed" as const,
      access: "awaiting_payment" as const,
    };
    const cards = accountProducts(
      [ground, { ...ground, active: false }],
      [failed, payment],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      payment,
      access: "ready",
      history: [failed, payment],
    });
  });
  it("does not invent a price for a manual grant", () => {
    const [card] = accountProducts([{ ...ground, source: "manual" }], []);
    expect(card).toMatchObject({
      access: "ready",
      payment: undefined,
      history: [],
    });
  });
  it("keeps a pending or failed purchase without access grounds", () => {
    for (const state of ["pending", "failed"] as const) {
      const attempt = {
        ...payment,
        state,
        access: "awaiting_payment" as const,
      };
      expect(accountProducts([], [attempt])).toMatchObject([
        { payment: attempt, access: "awaiting_payment" },
      ]);
    }
  });
  it("keeps refunds and prioritizes per-product access over the bundle fallback", () => {
    for (const refundedKopecks of [1500, 3000]) {
      const refund = {
        ...payment,
        refundedKopecks,
        productAccess: [
          { productId: cabinetProduct.id, access: "unavailable" as const },
        ],
      };
      expect(accountProducts([], [refund])).toMatchObject([
        { payment: refund, access: "unavailable" },
      ]);
    }
  });
  it("retains the whole bundle amount and content instead of allocating a product price", () => {
    const second = {
      ...cabinetProduct,
      id: "another-product",
      title: "Second product",
      slug: null,
    };
    const bundle = { ...payment, content: [cabinetProduct, second] };
    const cards = accountProducts([], [bundle]);
    expect(cards).toHaveLength(2);
    for (const card of cards) expect(card.payment).toBe(bundle);
    expect(cards[1]?.product.slug).toBeNull();
  });
});
