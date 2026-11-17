import { beforeEach, expect, it } from "vitest";

import { catalogBackend } from "../support/catalog-backend";
let catalog: ReturnType<typeof catalogBackend>;

import {
  loadProductSalesState,
  loadProductSalesStates,
} from "@/entities/subscription/api/billing-catalog.server";

beforeEach(() => {
  catalog = catalogBackend();
});

it("requests the scoped cohort even when its Product is after the global hundred-row cap", async () => {
  const productId = "47000000-0000-4000-8000-000000000101";
  const cohort = {
    productId,
    revision: 1,
    name: "Cohort 101",
    stage: "preorder",
    startsOn: "2026-11-01",
    nextEvent: "Launch",
    priceAfterStartKopecks: null,
  };
  catalog.sales.mockImplementation((request) =>
    Promise.resolve(
      Response.json({
        items:
          new URL(request.url).searchParams.get("productId") === productId
            ? [cohort]
            : [],
        nextCursor: null,
      }),
    ),
  );

  await expect(loadProductSalesState(productId)).resolves.toEqual({
    kind: "ready",
    cohort,
  });
  expect(catalog.sales).toHaveBeenCalledOnce();
  expect(
    new URL(catalog.sales.mock.calls[0]?.[0].url ?? "").searchParams.get(
      "productId",
    ),
  ).toBe(productId);
});

it("completes the owner cohort list through the bounded continuation", async () => {
  const id = (ordinal: number) =>
    `47000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
  const cohort = (ordinal: number) => ({
    productId: id(ordinal),
    revision: 1,
    name: `Cohort ${String(ordinal)}`,
    stage: "preorder",
    startsOn: "2026-11-01",
    nextEvent: "Launch",
  });
  catalog.sales
    .mockResolvedValueOnce(
      Response.json({
        items: Array.from({ length: 100 }, (_, index) => cohort(index + 1)),
        nextCursor: id(100),
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ items: [cohort(101)], nextCursor: null }),
    );
  const result = await loadProductSalesStates();
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw new Error("Expected complete list");
  expect(result.cohorts).toHaveLength(101);
  expect(result.cohorts.at(-1)?.productId).toBe(id(101));
  const last = catalog.sales.mock.calls.at(-1)?.[0];
  expect(new URL(last?.url ?? "").searchParams.get("cursor")).toBe(id(100));
  expect(new URL(last?.url ?? "").searchParams.has("productId")).toBe(false);
  expect(catalog.sales).toHaveBeenCalledTimes(2);
});

it("rejects a global page missing its exhaustion or continuation field", async () => {
  catalog.sales.mockResolvedValueOnce(Response.json({ items: [] }));
  await expect(loadProductSalesStates()).resolves.toEqual({
    kind: "unavailable",
  });
});

it("accepts explicit null as exhausted global cohort history", async () => {
  catalog.sales.mockResolvedValueOnce(
    Response.json({ items: [], nextCursor: null }),
  );
  await expect(loadProductSalesStates()).resolves.toEqual({
    kind: "ready",
    cohorts: [],
  });
});
