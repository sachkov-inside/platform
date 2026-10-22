import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

/** Ответ маршрута на каждую команду браузерного адаптера; вход приходит разобранным JSON. */
const fakes = { request: vi.fn() };
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
  vi.stubGlobal(
    "fetch",
    async (url: string, init: RequestInit): Promise<Response> => {
      const answer = z
        .union([
          z.object({ ok: z.literal(true), body: z.unknown() }),
          z.object({ ok: z.literal(false), status: z.number() }),
        ])
        .parse(
          await fakes.request(
            url,
            init.method,
            JSON.parse(z.string().parse(init.body)),
          ),
        );
      return answer.ok
        ? Response.json(answer.body)
        : new Response(null, { status: answer.status });
    },
  );
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
  expect(listTiersSchema.parse(fakes.request.mock.calls[1]?.[2])).toMatchObject(
    {
      cursor: id(100),
      limit: 100,
    },
  );
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
