import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/same-origin-mutation", () => ({
  requestSameOriginMutation: fakes.request,
}));
import { listAllSubscriptionTiers } from "@/features/billing-admin/api/enrollments.browser";
import { listTiersSchema } from "@/features/billing-admin/model/enrollment-operations";

const id = (ordinal: number) =>
  `46000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
function tier(ordinal: number, availableForAssignment: boolean) {
  return {
    tier: {
      id: id(ordinal),
      revision: 1,
      name: `Tier ${String(ordinal)}`,
      benefits: ["materials"],
      coverage: { productIds: [], materialIds: [] },
    },
    availableForAssignment,
    published: false,
    archived: false,
  };
}
function page(
  items: readonly ReturnType<typeof tier>[],
  nextCursor: string | null,
) {
  return {
    ok: true,
    body: {
      ok: true,
      value: {
        operationRef: id(500),
        result: { outcome: "tiers", items, nextCursor },
      },
    },
  };
}
beforeEach(() => {
  fakes.request.mockReset();
});

it("reaches an assignable Tier after a hundred nonassignable rows and keeps its cursor through BFF validation", async () => {
  fakes.request
    .mockResolvedValueOnce(
      page(
        Array.from({ length: 100 }, (_, index) => tier(index + 1, false)),
        id(100),
      ),
    )
    .mockResolvedValueOnce(page([tier(101, true)], null));
  const result = await listAllSubscriptionTiers();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  expect(
    result.value.result.items
      .filter((row) => row.availableForAssignment)
      .map((row) => row.tier.id),
  ).toEqual([id(101)]);
  expect(fakes.request).toHaveBeenCalledTimes(2);
  const payload: unknown = fakes.request.mock.calls[1]?.[2];
  if (!(payload instanceof FormData))
    throw new Error("Expected command FormData");
  const raw = payload.get("input");
  if (typeof raw !== "string") throw new Error("Expected command input");
  expect(listTiersSchema.parse(JSON.parse(raw))).toMatchObject({
    cursor: id(100),
    limit: 100,
  });
});

it("keeps failed continuation explicit and retryable instead of committing an incomplete selector", async () => {
  fakes.request
    .mockResolvedValueOnce(page([tier(1, false)], id(1)))
    .mockResolvedValueOnce({ ok: false, status: 503 });
  expect(await listAllSubscriptionTiers()).toEqual({
    ok: false,
    code: "unavailable",
  });
});
