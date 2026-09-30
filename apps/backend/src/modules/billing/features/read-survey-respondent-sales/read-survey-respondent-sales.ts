import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

const querySchema = z.strictObject({
  guideId: z.uuid().toLowerCase().nullable(),
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

  async read(query: {
    readonly guideId: string | null;
    readonly from: Date;
    readonly to: Date;
  }): Promise<SurveyRespondentSalesResult> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success || parsed.data.from >= parsed.data.to)
      return { ok: false, error: { code: "invalid_request" } };
    const { guideId, from, to } = parsed.data;
    try {
      const [uploaded, issued] = await Promise.all([
        this.prisma.billingSurveyRespondent.count(),
        this.prisma.billingSurveyRespondent.count({
          where: { issuedAt: { not: null } },
        }),
      ]);
      if (uploaded === 0) return { ok: true, value: null };
      if (guideId === null)
        return { ok: true, value: { uploaded, issued, paid: null } };
      const namesGuide = Prisma.sql`jsonb_build_array(${guideId}::text)`;
      const rows = countRowsSchema.parse(
        await this.prisma.$queryRaw(Prisma.sql`
          select count(distinct respondent.username) as paid
          from billing.survey_respondents as respondent
          join billing.promo_reservations as reservation
            on reservation.promotion_id = respondent.promotion_id
          join billing.purchases as purchase on purchase.id = reservation.purchase_ref
          where reservation.state = 'confirmed'
            and purchase.state = 'confirmed'
            and purchase.kind in ('initial', 'one_time')
            and purchase.snapshot -> 'offer' -> 'contentScope' -> 'guideIds' @> ${namesGuide}
            and purchase.confirmed_at >= ${from}
            and purchase.confirmed_at < ${to}
        `),
      );
      return {
        ok: true,
        value: { uploaded, issued, paid: Number(rows[0]?.paid ?? 0n) },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "readSurveyRespondentSales" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }
}
