import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ cohorts: vi.fn() }));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestProductCohorts: fakes.cohorts,
}));
vi.mock("@/shared/auth/index.server", () => ({
  getOptionalPlatformAccessToken: vi.fn(),
}));
import {
  loadProductCohort,
  loadProductCohorts,
} from "@/entities/subscription/api/billing-catalog.server";

beforeEach(() => {
  fakes.cohorts.mockReset();
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
  fakes.cohorts.mockImplementation((scope?: string) =>
    Promise.resolve({
      ok: true,
      body: { items: scope === productId ? [cohort] : [], nextCursor: null },
      response: new Response(),
    }),
  );
  await expect(loadProductCohort(productId)).resolves.toEqual({
    kind: "ready",
    cohort,
  });
  expect(fakes.cohorts).toHaveBeenCalledWith(productId);
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
  fakes.cohorts
    .mockResolvedValueOnce({
      ok: true,
      body: {
        items: Array.from({ length: 100 }, (_, index) => cohort(index + 1)),
        nextCursor: id(100),
      },
    })
    .mockResolvedValueOnce({
      ok: true,
      body: { items: [cohort(101)], nextCursor: null },
    });
  const result = await loadProductCohorts();
  expect(result.kind).toBe("ready");
  if (result.kind !== "ready") throw new Error("Expected complete list");
  expect(result.cohorts).toHaveLength(101);
  expect(result.cohorts.at(-1)?.productId).toBe(id(101));
  expect(fakes.cohorts).toHaveBeenLastCalledWith(undefined, id(100));
});

it("rejects a global page missing its exhaustion or continuation field", async () => {
  fakes.cohorts.mockResolvedValue({ ok: true, body: { items: [] } });
  await expect(loadProductCohorts()).resolves.toEqual({ kind: "unavailable" });
});

it("accepts explicit null as exhausted global cohort history", async () => {
  fakes.cohorts.mockResolvedValue({
    ok: true,
    body: { items: [], nextCursor: null },
  });
  await expect(loadProductCohorts()).resolves.toEqual({
    kind: "ready",
    cohorts: [],
  });
});
