import { expect, it, vi } from "vitest";
import { loadProductSaleAvailability } from "@/entities/subscription.availability.server";

it("reads sale admission for 101 Products in two bounded private requests without a programme or cohort read", async () => {
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  const productIds = Array.from(
    { length: 101 },
    (_, index) =>
      `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const observed: string[][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((request: Request) => {
      expect(request.url).toContain("/library/products/sale-availability?");
      expect(request.headers.get("authorization")).toBe("Bearer viewer-token");
      expect(request.cache).toBe("no-store");
      const ids = new URL(request.url).searchParams.getAll("productId");
      observed.push(ids);
      return Promise.resolve(
        Response.json({
          items: ids.map((productId) => ({
            productId,
            sold: productId === productIds[100],
          })),
        }),
      );
    }),
  );
  const result = await loadProductSaleAvailability(productIds, "viewer-token");
  expect(observed.map((ids) => ids.length)).toEqual([100, 1]);
  expect(result).toEqual({
    kind: "ready",
    soldProductIds: new Set([productIds[100]]),
  });
});

it("treats an incomplete sale projection as unavailable, rather than no-sale", async () => {
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ items: [] }))),
  );
  expect(
    await loadProductSaleAvailability(["20000000-0000-4000-8000-000000000001"]),
  ).toEqual({ kind: "unavailable" });
});

import { resolvePurchaseProduct } from "@/_pages/material-reader/api/resolve-purchase-product.server";

it.each([1, 10, 100])(
  "keeps no-sale, sole-sale and ambiguous invitations for %i memberships with one scoped read",
  async (size) => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const memberships = Array.from({ length: size }, (_, index) => ({
      ordinal: index + 1,
      series: {
        id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        slug: `product-${String(index + 1)}`,
        name: `Product ${String(index + 1)}`,
      },
    }));
    for (const sale of ["none", "sole", "multiple"] as const) {
      const boundary = vi.fn((request: Request) => {
        const url = new URL(request.url);
        expect(url.pathname).toBe("/library/products/sale-availability");
        expect(request.headers.has("authorization")).toBe(false);
        const ids = url.searchParams.getAll("productId");
        expect(ids).toHaveLength(size);
        return Promise.resolve(
          Response.json({
            items: ids.map((productId, index) => ({
              productId,
              sold:
                sale === "sole"
                  ? index === 0
                  : sale === "multiple" && index < 2,
            })),
          }),
        );
      });
      vi.stubGlobal("fetch", boundary);
      const result = await resolvePurchaseProduct(
        { seriesMemberships: memberships },
        undefined,
      );
      expect(result).toEqual(
        sale === "sole" || (sale === "multiple" && size === 1)
          ? { kind: "ready", product: { slug: "product-1", sold: true } }
          : { kind: "ready", product: undefined },
      );
      expect(boundary).toHaveBeenCalledOnce();
    }
  },
);

it("keeps explicit return Product precedence without reading other membership programmes", async () => {
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  const material = {
    seriesMemberships: [1, 2].map((index) => ({
      ordinal: index,
      series: {
        id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        slug: `product-${String(index)}`,
        name: "Product",
      },
    })),
  };
  const boundary = vi.fn((request: Request) => {
    const ids = new URL(request.url).searchParams.getAll("productId");
    expect(ids).toEqual(["20000000-0000-4000-8000-000000000002"]);
    return Promise.resolve(
      Response.json({
        items: ids.map((productId) => ({ productId, sold: true })),
      }),
    );
  });
  vi.stubGlobal("fetch", boundary);
  expect(await resolvePurchaseProduct(material, "product-2")).toEqual({
    kind: "ready",
    product: { slug: "product-2", sold: true },
  });
  expect(boundary).toHaveBeenCalledOnce();
});

it.each(["malformed", "missing"])(
  "keeps a %s legacy membership ID unavailable instead of choosing another sole Product",
  async (input) => {
    vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
    const boundary = vi.fn(() => Promise.resolve(Response.json({ items: [] })));
    vi.stubGlobal("fetch", boundary);
    const series = {
      slug: "unknown",
      name: "Unknown",
      id: "not-a-product-id",
    };
    if (input === "missing") Reflect.deleteProperty(series, "id");
    const result = await resolvePurchaseProduct(
      {
        seriesMemberships: [
          {
            ordinal: 1,
            series,
          },
        ],
      },
      undefined,
    );
    expect(result).toEqual({ kind: "unavailable" });
    expect(boundary).not.toHaveBeenCalled();
  },
);

it("keeps an unavailable sale transport retryable for default and explicit invitations", async () => {
  vi.stubEnv("BACKEND_BASE_URL", "https://platform-api.example.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
  );
  const material = {
    seriesMemberships: [
      {
        ordinal: 1,
        series: {
          id: "20000000-0000-4000-8000-000000000001",
          slug: "product-1",
          name: "Product",
        },
      },
    ],
  };
  expect(await resolvePurchaseProduct(material, undefined)).toEqual({
    kind: "unavailable",
  });
  expect(await resolvePurchaseProduct(material, "product-1")).toEqual({
    kind: "unavailable",
  });
});
