import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type BillingPrismaClient,
} from "../../../../infrastructure/prisma/index.js";

const productIdSchema = z.uuid().toLowerCase();
const rowsSchema = z.array(
  z.object({ account_id: z.uuid(), first_at: z.date() }),
);

export type ProductSalesResult =
  | {
      readonly ok: true;
      readonly value: {
        /** Account ID to the first time it priced an Offer naming this Product. */
        readonly checkout: ReadonlyMap<string, Date>;
        /** Account ID to its first confirmed payment for such an Offer. */
        readonly paid: ReadonlyMap<string, Date>;
      };
    }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_request" | "dependency_unavailable";
      };
    };

/**
 * Who reached checkout and who paid for one Product, with the first time of each. The Offer must
 * name the Product in its content scope: a subscription covering all Products is not a purchase of
 * this one.
 */
export class BillingProductSales {
  constructor(private readonly prisma: BillingPrismaClient) {}

  async list(productId: string): Promise<ProductSalesResult> {
    const parsed = productIdSchema.safeParse(productId);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request" } };
    const namesProduct = Prisma.sql`jsonb_build_array(${parsed.data}::text)`;
    try {
      const [checkout, paid] = await Promise.all([
        this.prisma.$queryRaw(Prisma.sql`
          select quote.account_id, min(quote.created_at) as first_at
          from billing.price_quotes as quote
          where quote.snapshot -> 'offer' -> 'coverage' -> 'productIds' @> ${namesProduct}
          group by quote.account_id
        `),
        this.prisma.$queryRaw(Prisma.sql`
          select purchase.account_id, min(purchase.confirmed_at) as first_at
          from billing.purchases as purchase
          where purchase.state = 'confirmed'
            and purchase.kind in ('initial', 'one_time')
            and purchase.snapshot -> 'offer' -> 'coverage' -> 'productIds' @> ${namesProduct}
          group by purchase.account_id
        `),
      ]);
      const byAccount = (rows: unknown) =>
        new Map(
          rowsSchema.parse(rows).map((row) => [row.account_id, row.first_at]),
        );
      return {
        ok: true,
        value: { checkout: byAccount(checkout), paid: byAccount(paid) },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "listProductSales" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } } as const,
      );
    }
  }
}
