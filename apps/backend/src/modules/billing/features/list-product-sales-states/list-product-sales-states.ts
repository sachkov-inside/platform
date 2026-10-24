import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { productSalesStateSchema } from "../../domain/product-sales-state.js";
import { failure, type PricingResult } from "../../domain/pricing.js";

/** Сколько продуктов с потоком читается за раз: публичный legacy список ограничен; Web читает нужный Product явно. */
export const productSalesListLimit = 100;

export const productSalesStatesQuerySchema = z
  .strictObject({ productId: z.uuid().optional(), cursor: z.uuid().optional() })
  .refine(
    (query) => query.productId === undefined || query.cursor === undefined,
    "Scoped Product reads do not take a list cursor",
  );

export const productSalesStatesSchema = z.strictObject({
  items: z.array(productSalesStateSchema).max(productSalesListLimit),
  nextCursor: z.uuid().nullable(),
});

/**
 * Текущие потоки продуктов для страницы продукта и бота. Поток — публичный факт, он не зависит
 * от читателя; цену и продажу страница берёт из предложений, а не отсюда. Цена после старта
 * здесь только для витрины: страница показывает её зачёркнутой, а списание её не читает.
 */
export async function listProductSalesStates(
  prisma: BillingPrismaClient,
  productId?: string,
  cursor?: string,
): Promise<
  PricingResult<
    z.infer<typeof productSalesStatesSchema>,
    "invalid_request" | "dependency_unavailable"
  >
> {
  const parsed = productSalesStatesQuerySchema.safeParse({ productId, cursor });
  if (!parsed.success) return failure("invalid_request");
  try {
    const rows = await prisma.billingProductSalesState.findMany({
      ...(parsed.data.productId === undefined
        ? parsed.data.cursor === undefined
          ? {}
          : { where: { productId: { gt: parsed.data.cursor } } }
        : { where: { productId: parsed.data.productId } }),
      orderBy: { productId: "asc" },
      take: productSalesListLimit + 1,
    });
    return {
      ok: true,
      value: productSalesStatesSchema.parse({
        items: rows.slice(0, productSalesListLimit).map((row) => ({
          productId: row.productId,
          revision: row.revision,
          name: row.name,
          stage: row.stage,
          startsOn: row.startsOn?.toISOString().slice(0, 10) ?? null,
          nextEvent: row.nextEvent,
          priceAfterStartKopecks:
            row.priceAfterStartKopecks === null
              ? null
              : Number(row.priceAfterStartKopecks),
        })),
        nextCursor:
          rows.length > productSalesListLimit
            ? (rows[productSalesListLimit - 1]?.productId ?? null)
            : null,
      }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "listProductSalesStates" },
      error,
      failure("dependency_unavailable"),
    );
  }
}
