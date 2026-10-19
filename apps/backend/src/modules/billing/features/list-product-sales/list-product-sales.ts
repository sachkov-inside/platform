import {
  DIAGNOSTIC_SOURCE_ROW_LIMIT,
  diagnosticAccountScopeSchema,
  type DiagnosticAccountScope,
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

  list(productId: string): Promise<ProductSalesResult> {
    return readBillingProductSales(this.prisma, productId);
  }

  async listForDiagnostics(
    productId: string,
    scope?: DiagnosticAccountScope,
  ): Promise<ProductSalesResult | DiagnosticSourceBudgetFailure> {
    if (!productIdSchema.safeParse(productId).success)
      return { ok: false, error: { code: "invalid_request" } };
    const parsedScope =
      scope === undefined
        ? undefined
        : diagnosticAccountScopeSchema.safeParse(scope);
    if (parsedScope !== undefined && !parsedScope.success)
      return { ok: false, error: { code: "invalid_request" } };
    const normalizedScope = parsedScope?.data;
    const boundedScope =
      normalizedScope !== undefined && "accountIds" in normalizedScope
        ? { accountIds: [...new Set(normalizedScope.accountIds)] }
        : normalizedScope;
    if (
      boundedScope !== undefined &&
      "accountIds" in boundedScope &&
      boundedScope.accountIds.length > DIAGNOSTIC_SOURCE_ROW_LIMIT
    )
      return diagnosticSourceBudgetFailure;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await setDiagnosticStatementBudget(transaction);
        return readBillingProductSales(
          transaction,
          productId,
          "listForDiagnostics",
          boundedScope,
        );
      }, diagnosticSnapshotOptions);
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "listForDiagnostics" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
}

function readBillingProductSales(
  prisma: BillingPrisma,
  productId: string,
): Promise<ProductSalesResult>;
function readBillingProductSales(
  prisma: BillingPrisma,
  productId: string,
  operation: "listForDiagnostics",
  scope?: DiagnosticAccountScope,
): Promise<ProductSalesResult | DiagnosticSourceBudgetFailure>;
async function readBillingProductSales(
  prisma: BillingPrisma,
  productId: string,
  operation = "listProductSales",
  scope?: DiagnosticAccountScope,
): Promise<ProductSalesResult | DiagnosticSourceBudgetFailure> {
  const parsed = productIdSchema.safeParse(productId);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const namesProduct = Prisma.sql`jsonb_build_array(${parsed.data}::text)`;
  const accountIds =
    scope !== undefined && "accountIds" in scope ? [...scope.accountIds] : null;
  const quoteAccounts =
    accountIds === null
      ? Prisma.empty
      : Prisma.sql`and quote.account_id = any(${accountIds}::uuid[])`;
  const purchaseAccounts =
    accountIds === null
      ? Prisma.empty
      : Prisma.sql`and purchase.account_id = any(${accountIds}::uuid[])`;
  const quoteWindow =
    scope !== undefined && "from" in scope
      ? Prisma.sql`having min(quote.created_at) >= ${scope.from} and min(quote.created_at) < ${scope.to}`
      : Prisma.empty;
  const purchaseWindow =
    scope !== undefined && "from" in scope
      ? Prisma.sql`having min(purchase.confirmed_at) >= ${scope.from} and min(purchase.confirmed_at) < ${scope.to}`
      : Prisma.empty;
  const limit =
    operation === "listForDiagnostics"
      ? Prisma.sql`limit ${DIAGNOSTIC_SOURCE_ROW_LIMIT + 1}`
      : Prisma.empty;
  try {
    const [checkout, paid] = await Promise.all([
      prisma.$queryRaw(Prisma.sql`
          select quote.account_id, min(quote.created_at) as first_at
          from billing.price_quotes as quote
          where quote.snapshot -> 'offer' -> 'coverage' -> 'productIds' @> ${namesProduct}
          ${quoteAccounts}
          group by quote.account_id ${quoteWindow} ${limit}
        `),
      prisma.$queryRaw(Prisma.sql`
          select purchase.account_id, min(purchase.confirmed_at) as first_at
          from billing.purchases as purchase
          where purchase.state = 'confirmed'
            and purchase.kind in ('initial', 'one_time')
            and purchase.snapshot -> 'offer' -> 'coverage' -> 'productIds' @> ${namesProduct}
          ${purchaseAccounts}
          group by purchase.account_id ${purchaseWindow} ${limit}
        `),
    ]);
    if (
      operation === "listForDiagnostics" &&
      (rowsSchema.parse(checkout).length > DIAGNOSTIC_SOURCE_ROW_LIMIT ||
        rowsSchema.parse(paid).length > DIAGNOSTIC_SOURCE_ROW_LIMIT)
    )
      return diagnosticSourceBudgetFailure;
    const byAccount = (rows: unknown) =>
      new Map(
        rowsSchema.parse(rows).map((row) => [row.account_id, row.first_at]),
      );
    return {
      ok: true,
      value: { checkout: byAccount(checkout), paid: byAccount(paid) },
    };
  } catch (error) {
    return dependencyFailure({ module: "billing", operation }, error, {
      ok: false,
      error: { code: "dependency_unavailable" },
    } as const);
  }
}
