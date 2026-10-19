import { afterEach, beforeEach, expect, it } from "vitest";
import { assembleTestFunnel } from "../fixtures/sales-funnel.js";
import { BillingProductSales } from "../../src/modules/billing/index.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";
import { createQueryRowClient } from "./setup/query-rows.js";

const actor = "10000000-0000-4000-8000-000000000001";
const at = new Date("2026-10-19T10:00:00Z");
const input = { from: "2026-10-18T21:00:00Z", to: "2026-10-19T21:00:00Z" };
const id = (index: number) =>
  `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
let database: TestDatabase;
beforeEach(async () => {
  database = await createMigratedTestDatabase();
  await database.prisma.account.create({
    data: {
      id: actor,
      logtoIssuer: "https://funnel.example.test",
      logtoSubject: actor,
    },
  });
  await database.prisma.accountPermission.create({
    data: { accountId: actor, permission: "platform:admin" },
  });
});
afterEach(async () => {
  await database.dispose();
});

it.each(["journal", "sales"] as const)(
  "%s physically stops at cap+1 source rows before an aggregate scan",
  async (source) => {
    if (source === "journal")
      await database.prisma.salesFunnelBotEvent.createMany({
        data: Array.from({ length: 2_100 }, (_, index) => ({
          eventId: id(index + 1),
          contactRef: id(index + 1),
          kind: "bot_entered",
          sourceCode: "fixture",
          occurredAt: at,
          receivedAt: at,
        })),
      });
    else
      await database.prisma.billingPriceQuote.createMany({
        data: Array.from({ length: 2_100 }, (_, index) => ({
          id: id(index + 1),
          accountId: actor,
          operationId: id(index + 1),
          fingerprint: "fixture",
          snapshot: {},
          createdAt: at,
          expiresAt: new Date("2026-10-19T11:00:00Z"),
        })),
      });
    const observer = createQueryRowClient(database.url);
    try {
      const measured = await observer.measure(async () =>
        source === "journal"
          ? await assembleTestFunnel(observer.prisma).readDiagnostics(
              actor,
              input,
            )
          : await new BillingProductSales(observer.prisma).listForDiagnostics(
              actor,
            ),
      );
      expect(measured.result).toMatchObject({
        ok: false,
        error: { code: "source_budget_exceeded" },
      });
      if (source === "journal")
        expect(measured.result).toMatchObject({ coverage: "unknown" });
      const sourceTable =
        source === "journal"
          ? '"sales_funnel"."bot_events"'
          : '"billing"."price_quotes"';
      const sourceReads = measured.rows.filter((row) =>
        row.statement.includes(sourceTable),
      );
      expect(sourceReads).toHaveLength(1);
      expect(sourceReads[0]?.count).toBe(2_001);
      expect(sourceReads[0]?.statement).toContain("LIMIT");
      expect(
        measured.statements.some(
          (statement) =>
            statement.includes("distinct on (contact_ref)") ||
            statement.includes("min(quote.created_at)"),
        ),
      ).toBe(false);
      expect(
        measured.statements.some((statement) =>
          statement.includes("set_config('statement_timeout'"),
        ),
      ).toBe(true);
    } finally {
      await observer.prisma.$disconnect();
    }
  },
);
