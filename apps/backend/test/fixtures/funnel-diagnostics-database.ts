import { vi } from "vitest";
import { z } from "zod";
import type {
  PlatformPrisma,
  Prisma,
} from "../../src/infrastructure/prisma/index.js";
import { diagnosticDatabase } from "./payment-diagnostics-database.js";

/** External database double only. The real owner facades and shared cohort operation run unchanged. */
export function funnelDiagnosticDatabase(
  input: {
    sourceRows?: Readonly<Record<string, number>>;
    contacts?: unknown[];
    compositions?: unknown[];
    failTable?: string;
    lastReceivedAt?: Date | null;
    surveyCounts?: { uploaded: number; issued: number };
  } = {},
) {
  const queries: string[] = [];
  const guards: { table: string; take: number }[] = [];
  const takeSchema = z.object({ take: z.number().int() });
  const database = {
    ...diagnosticDatabase(),
    $queryRaw: vi.fn().mockImplementation((query: Prisma.Sql) => {
      const sql = query.strings.join("?");
      queries.push(sql);
      if (sql.includes("set_config")) return Promise.resolve([]);
      const sourceTables: Readonly<Record<string, string>> = {
        salesFunnelBotEvent: "sales_funnel.bot_events",
        billingPriceQuote: "billing.price_quotes",
        billingPurchase: "billing.purchases",
        readingMaterialVisit: "reading_activity.material_visits",
      };
      if (
        input.failTable !== undefined &&
        sql.includes(sourceTables[input.failTable] ?? "never-source")
      )
        return Promise.reject(new Error("source offline"));
      if (sql.includes("from materials.series"))
        return Promise.resolve(input.compositions ?? []);
      if (
        sql.includes("max(received_at)") ||
        sql.includes("order by received_at desc")
      )
        return Promise.resolve([
          {
            received_at:
              input.lastReceivedAt === undefined
                ? new Date("2026-10-19T10:00:00Z")
                : input.lastReceivedAt,
          },
        ]);
      return Promise.resolve(input.contacts ?? []);
    }),
    billingSurveyRespondent: {
      count: vi
        .fn()
        .mockImplementation((query: unknown) =>
          Promise.resolve(
            query === undefined
              ? (input.surveyCounts?.uploaded ?? 0)
              : (input.surveyCounts?.issued ?? 0),
          ),
        ),
    },
  };
  for (const table of [
    "product",
    "productProgrammePlacement",
    "productChapter",
    "productChapterSupplementaryMaterial",
    "productMembership",
    "publishedMaterialProductMembership",
    "material",
    "publishedMaterial",
    "salesFunnelBotEvent",
    "billingSurveyRespondent",
    "billingPromoReservation",
    "billingPurchase",
    "billingPriceQuote",
    "readingMaterialVisit",
    "telegramAccountLinkState",
  ]) {
    Object.assign(database, {
      [table]: {
        ...(table === "billingSurveyRespondent"
          ? database.billingSurveyRespondent
          : {}),
        findMany: vi.fn().mockImplementation((query: unknown) => {
          const { take } = takeSchema.parse(query);
          guards.push({ table, take });
          if (input.failTable === table)
            return Promise.reject(new Error("source offline"));
          return Promise.resolve(
            Array.from(
              { length: Math.min(input.sourceRows?.[table] ?? 0, take) },
              () => ({}),
            ),
          );
        }),
      },
    });
  }
  Object.assign(database, {
    $transaction: vi
      .fn()
      .mockImplementation((read: (transaction: unknown) => Promise<unknown>) =>
        read(database),
      ),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Unit fixture substitutes external Prisma reads; PostgreSQL acceptance proves query constraints and snapshot execution.
  const prisma = database as unknown as PlatformPrisma;
  return { prisma, queries, guards };
}
