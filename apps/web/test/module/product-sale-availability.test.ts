import { expect, it, vi } from "vitest";
import { loadProductSaleAvailability } from "@/entities/subscription/api/product-sale-availability.server";

it("reads sale admission for 101 Products in two bounded private requests without a programme or cohort read", async () => {
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  const productIds = Array.from({ length: 101 }, (_, index) => `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  const observed: string[][] = [];
  vi.stubGlobal("fetch", vi.fn((request: Request) => {
    expect(request.url).toContain("/billing/products/sale-availability?");
    expect(request.headers.get("authorization")).toBe("Bearer viewer-token");
    expect(request.cache).toBe("no-store");
    const ids = new URL(request.url).searchParams.getAll("productId");
    observed.push(ids);
    return Promise.resolve(Response.json({ items: ids.map((productId) => ({ productId, sold: productId === productIds[100] })) }));
  }));
  const result = await loadProductSaleAvailability(productIds, "viewer-token");
  expect(observed.map((ids) => ids.length)).toEqual([100, 1]);
  expect(result).toEqual({ kind: "ready", soldProductIds: new Set([productIds[100]]) });
});

it("treats an incomplete sale projection as unavailable, rather than no-sale", async () => {
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json({ items: [] }))));
  expect(await loadProductSaleAvailability(["20000000-0000-4000-8000-000000000001"])).toEqual({ kind: "unavailable" });
});
