import { describe, expect, test } from "vitest";

import { readAuthoringOverview } from "../../../src/modules/authoring-overview/features/read-authoring-overview/read-authoring-overview.js";
import { readProductOverview } from "../../../src/modules/authoring-overview/features/read-product-overview/read-product-overview.js";
import type { OverviewDependencies } from "../../../src/modules/authoring-overview/shared/overview-composition.js";

const actor = "17193000-0000-4000-8000-000000000001";
const product = "17193000-0000-4000-8000-00000000000a";
const instant = new Date("2026-10-07T09:00:00.000Z");

/** Owners that answer with nothing, so one failing owner shows what it alone turns unavailable. */
function owners(
  overrides: Partial<OverviewDependencies> = {},
): OverviewDependencies {
  const empty = { ok: true as const, days: [] };
  return {
    accounts: {
      checkPermission: () => Promise.resolve({ ok: true, allowed: true }),
    },
    directory: {
      countNewPeople: () => Promise.resolve(empty),
      listDirectory: () =>
        Promise.resolve({
          ok: true,
          value: { items: [], total: 0, next: null },
        }),
    },
    links: {
      listLinkedAccountIds: () => Promise.resolve({ ok: true, accountIds: [] }),
    },
    sales: {
      readDailySales: () =>
        Promise.resolve({ ok: true, sales: [], revenue: [] }),
      countAttention: () =>
        Promise.resolve({
          ok: true,
          undetermined: 0,
          fulfillmentIncomplete: 0,
        }),
      listRecentPayments: () => Promise.resolve({ ok: true, items: [] }),
    },
    access: {
      readNewAccessByDay: () => Promise.resolve(empty),
      listRecentAccessActions: () => Promise.resolve({ ok: true, items: [] }),
      countActiveHolders: () => Promise.resolve({ ok: true, groups: [] }),
      listAccessAccounts: () => Promise.resolve({ ok: true, accountIds: [] }),
    },
    products: {
      metadata: () =>
        Promise.resolve([
          {
            id: product,
            createdAt: instant,
            name: "Альфа",
            slug: "alpha",
            summary: "",
            archivedAt: null,
            coverId: null,
          },
        ]),
    },
    outlines: { list: () => Promise.resolve({ ok: true, value: [] }) },
    funnel: {
      readReport: () =>
        Promise.resolve({
          ok: false,
          error: { code: "dependency_unavailable" },
        }),
    },
    waitlists: {
      countJoinsByDay: () => Promise.resolve(empty),
      demand: () => Promise.resolve({ ok: true, value: null }),
    },
    learning: {
      summarizeProductLearning: () =>
        Promise.resolve({
          ok: true,
          value: { accounts: 0, started: 0, averageProgress: null },
        }),
    },
    submissions: {
      countAwaitingFeedback: () =>
        Promise.resolve({ ok: true, value: { count: 0 } }),
      list: () =>
        Promise.resolve({
          ok: false,
          error: { code: "dependency_unavailable", retryable: true },
        }),
    },
    community: {
      listProblemAccounts: () => Promise.resolve({ ok: true, accountIds: [] }),
    },
    deliveries: {
      listTelegramProblemAccounts: () =>
        Promise.resolve({ ok: true, accountIds: [] }),
    },
    people: { readIdentities: () => Promise.resolve({ ok: true, value: [] }) },
    clock: () => instant,
    ...overrides,
  };
}

describe("Overview blocks answer on their own (#1719)", () => {
  test("a failed owner turns only its own block unavailable", async () => {
    const result = await readAuthoringOverview(
      owners({
        sales: {
          ...owners().sales,
          readDailySales: () =>
            Promise.resolve({
              ok: false,
              error: { code: "dependency_unavailable" },
            }),
        },
        community: {
          listProblemAccounts: () => Promise.resolve({ ok: false }),
        },
      }),
      actor,
      {},
    );
    if (!result.ok) throw new Error(result.error.code);
    const { metrics, attention, funnel, events, learning } = result.value;
    expect(metrics.state).toBe("ready");
    if (metrics.state !== "ready") return;
    expect(metrics.revenue).toEqual({ state: "unavailable" });
    expect(metrics.sales).toEqual({ state: "unavailable" });
    expect(metrics.newAccess.state).toBe("ready");
    expect(metrics.newAccounts.state).toBe("ready");
    expect(attention.communityFailures).toEqual({ state: "unavailable" });
    expect(attention.telegramDeliveryFailures).toEqual({
      state: "ready",
      count: 0,
    });
    expect(funnel).toEqual({ state: "unavailable" });
    expect(events.submissions).toBe("unavailable");
    expect(events.payments).toBe("ready");
    expect(learning).toEqual({
      state: "ready",
      products: [
        {
          productId: product,
          name: "Альфа",
          holders: 0,
          started: 0,
          averageProgress: null,
        },
      ],
    });
  });

  test("a failed permission check is a dependency failure, not a refusal", async () => {
    const failing = owners({
      accounts: {
        checkPermission: () =>
          Promise.resolve({
            ok: false,
            error: { code: "internal_error", correlationId: "c" },
          }),
      },
    });
    expect(await readAuthoringOverview(failing, actor, {})).toEqual({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
    expect(await readProductOverview(failing, actor, product, {})).toEqual({
      ok: false,
      error: { code: "dependency_unavailable" },
    });
  });

  test("a failed holder read leaves the rest of the Product Overview", async () => {
    const result = await readProductOverview(
      owners({
        access: {
          ...owners().access,
          countActiveHolders: () =>
            Promise.resolve({ ok: false, error: { code: "unavailable" } }),
        },
      }),
      actor,
      product,
      { period: "7" },
    );
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.holders).toEqual({ state: "unavailable" });
    expect(result.value.sales.state).toBe("ready");
    expect(result.value.waitlist).toEqual({ state: "ready", intake: null });
    expect(result.value.events).toEqual({ state: "ready", items: [] });
  });
});
