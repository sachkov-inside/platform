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
  { owner: "opens", table: "readingMaterialVisit" },
  { owner: "sales", table: "billingPriceQuote" },
  { owner: "survey", table: "billingPromoReservation" },
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
        : owner === "opens"
          ? await new MaterialFirstOpens(prisma).listForDiagnostics([productId])
          : owner === "sales"
            ? await new BillingProductSales(prisma).listForDiagnostics(
                productId,
              )
            : owner === "survey"
              ? await new BillingSurveyRespondentSales(
                  prisma,
                ).readForDiagnostics({
                  productId,
                  from: new Date("2026-10-18T21:00:00Z"),
                  to: new Date("2026-10-19T21:00:00Z"),
                })
              : await new TelegramAccountLinks(
                  prisma,
                ).findCurrentAccountsForDiagnostics(["identity"]);
    expect(result).toEqual({
      ok: false,
      error: { code: "source_budget_exceeded" },
    });
    expect(guards).toContainEqual({ table, take: 2_001 });
    expect(guards.every((guard) => guard.take === 2_001)).toBe(true);
    expect(queries.filter((query) => !query.includes("set_config"))).toEqual(
      [],
    );
  },
);
