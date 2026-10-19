import {
  DIAGNOSTIC_SOURCE_ROW_LIMIT,
  diagnosticSnapshotOptions,
  diagnosticSourceBudgetFailure,
  setDiagnosticStatementBudget,
  type DiagnosticSourceBudgetFailure,
} from "../../../../infrastructure/diagnostic-read-budget.js";
import type { BillingPrisma } from "../../../../infrastructure/prisma/index.js";
import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

const querySchema = z.strictObject({
  productId: z.uuid().toLowerCase().nullable(),
  from: z.date(),
  to: z.date(),
});
const countRowsSchema = z.array(z.object({ paid: z.bigint() }));

export type SurveyRespondentSales = {
  /** Ники в списке анкеты. */
  readonly uploaded: number;
  /** Ники, которым владелец выдал личную ссылку. */
  readonly issued: number;
  /**
   * Ники, чья личная ссылка закончилась подтверждённой оплатой предложения этого продукта в
   * `[from, to)`; `null` без выбранного продукта.
   */
  readonly paid: number | null;
};

export type SurveyRespondentSalesResult =
  | { readonly ok: true; readonly value: SurveyRespondentSales | null }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_request" | "dependency_unavailable";
      };
    };

/**
 * Итог скидки анкеты (#815) только в числах: ник не связан с Account (решение владельца от
 * 30.09.2026, #818), поэтому покупка респондента — это оплата по его личной ссылке. Пустой список
 * даёт `null`: основания ещё нет, а не ноль купивших.
 */
export class BillingSurveyRespondentSales {
  constructor(private readonly prisma: BillingPrismaClient) {}

  read(query: {
    readonly productId: string | null;
    readonly from: Date;
    readonly to: Date;
  }): Promise<SurveyRespondentSalesResult> {
    return readBillingSurveyRespondentSales(this.prisma, query);
  }

  async readForDiagnostics(query: {
    readonly productId: string | null;
    readonly from: Date;
    readonly to: Date;
  }): Promise<SurveyRespondentSalesResult | DiagnosticSourceBudgetFailure> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success || parsed.data.from >= parsed.data.to)
      return { ok: false, error: { code: "invalid_request" } };
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await setDiagnosticStatementBudget(transaction);
        const sources = await Promise.all([
          transaction.billingSurveyRespondent.findMany({
            take: DIAGNOSTIC_SOURCE_ROW_LIMIT + 1,
            select: { username: true },
          }),
          transaction.billingPromoReservation.findMany({
            take: DIAGNOSTIC_SOURCE_ROW_LIMIT + 1,
            select: { purchaseRef: true },
          }),
          transaction.billingPurchase.findMany({
            take: DIAGNOSTIC_SOURCE_ROW_LIMIT + 1,
            select: { id: true },
          }),
        ]);
        if (sources.some((rows) => rows.length > DIAGNOSTIC_SOURCE_ROW_LIMIT))
          return diagnosticSourceBudgetFailure;
        return readBillingSurveyRespondentSales(
          transaction,
          query,
          "readForDiagnostics",
        );
      }, diagnosticSnapshotOptions);
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "readForDiagnostics" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
}

async function readBillingSurveyRespondentSales(
  prisma: BillingPrisma,
  query: {
    readonly productId: string | null;
    readonly from: Date;
    readonly to: Date;
  },
  operation = "readSurveyRespondentSales",
): Promise<SurveyRespondentSalesResult> {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success || parsed.data.from >= parsed.data.to)
    return { ok: false, error: { code: "invalid_request" } };
  const { productId, from, to } = parsed.data;
  try {
    const [uploaded, issued] = await Promise.all([
      prisma.billingSurveyRespondent.count(),
      prisma.billingSurveyRespondent.count({
        where: { issuedAt: { not: null } },
      }),
    ]);
    if (uploaded === 0) return { ok: true, value: null };
    if (productId === null)
      return { ok: true, value: { uploaded, issued, paid: null } };
    const namesProduct = Prisma.sql`jsonb_build_array(${productId}::text)`;
    const rows = countRowsSchema.parse(
      await prisma.$queryRaw(Prisma.sql`
          select count(distinct respondent.username) as paid
          from billing.survey_respondents as respondent
          join billing.promo_reservations as reservation
            on reservation.promotion_id = respondent.promotion_id
          join billing.purchases as purchase on purchase.id = reservation.purchase_ref
          where reservation.state = 'confirmed'
            and purchase.state = 'confirmed'
            and purchase.kind in ('initial', 'one_time')
            and purchase.snapshot -> 'offer' -> 'coverage' -> 'productIds' @> ${namesProduct}
            and purchase.confirmed_at >= ${from}
            and purchase.confirmed_at < ${to}
        `),
    );
    return {
      ok: true,
      value: { uploaded, issued, paid: Number(rows[0]?.paid ?? 0n) },
    };
  } catch (error) {
    return dependencyFailure({ module: "billing", operation }, error, {
      ok: false,
      error: { code: "dependency_unavailable" },
    } as const);
  }
}
