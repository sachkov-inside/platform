import { expect, it } from "vitest";
import { ProductOutlines } from "../../src/modules/materials/index.js";
import { MaterialFirstOpens } from "../../src/modules/reading-activity/index.js";
import {
  BillingProductSales,
  BillingSurveyRespondentSales,
} from "../../src/modules/billing/index.js";
import { TelegramAccountLinks } from "../../src/modules/telegram-membership/index.js";
import { funnelDiagnosticDatabase } from "../fixtures/funnel-diagnostics-database.js";

const productId = "10000000-0000-4000-8000-000000000001";
it.each([
  { owner: "outlines", table: "productProgrammePlacement" },
  { owner: "links", table: "telegramAccountLinkState" },
])(
  "$owner caps source rows before aggregation rather than truncating a complete cohort",
  async ({ owner, table }) => {
    const { prisma, queries, guards } = funnelDiagnosticDatabase({
      sourceRows: { [table]: 2_001 },
    });
    const result =
      owner === "outlines"
        ? await new ProductOutlines(prisma).listForDiagnostics()
        : await new TelegramAccountLinks(
            prisma,
          ).findCurrentAccountsForDiagnostics(["identity"]);
    expect(result).toEqual({
      ok: false,
      error: { code: "source_budget_exceeded" },
    });
    expect(guards).toContainEqual({ table, take: 2_001 });

    expect(queries.filter((query) => !query.includes("set_config"))).toEqual(
      [],
    );
  },
);

it.each(["opens", "sales"] as const)(
  "%s refuses an incomplete bounded candidate result",
  async (owner) => {
    const { prisma } = funnelDiagnosticDatabase({
      contacts: Array.from({ length: 2001 }, () => ({
        account_id: productId,
        first_at: new Date("2026-10-19T00:00:00Z"),
        first_opened_at: new Date("2026-10-19T00:00:00Z"),
      })),
    });
    const result =
      owner === "opens"
        ? await new MaterialFirstOpens(prisma).listForDiagnostics([productId])
        : await new BillingProductSales(prisma).listForDiagnostics(productId);
    expect(result).toEqual({
      ok: false,
      error: { code: "source_budget_exceeded" },
    });
  },
);
it("survey scalar totals do not depend on a whole-table row probe", async () => {
  const { prisma, guards } = funnelDiagnosticDatabase({
    surveyCounts: { uploaded: 5000, issued: 3000 },
    sourceRows: {
      billingSurveyRespondent: 9000,
      billingPromoReservation: 9000,
      billingPurchase: 9000,
    },
  });
  expect(
    await new BillingSurveyRespondentSales(prisma).readForDiagnostics({
      productId: null,
      from: new Date("2026-10-18T21:00:00Z"),
      to: new Date("2026-10-19T21:00:00Z"),
    }),
  ).toEqual({ ok: true, value: { uploaded: 5000, issued: 3000, paid: null } });
  expect(guards).toEqual([]);
});
