import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { productCohortSchema } from "../../domain/product-cohort.js";
import { failure, type PricingResult } from "../../domain/pricing.js";

/** Сколько продуктов с потоком читается за раз: публичный legacy список ограничен; Web читает нужный Product явно. */
export const cohortListLimit = 100;

export const productCohortsQuerySchema = z
  .strictObject({ productId: z.uuid().optional(), cursor: z.uuid().optional() })
  .refine(
    (query) => query.productId === undefined || query.cursor === undefined,
    "Scoped Product reads do not take a list cursor",
  );

export const productCohortsSchema = z.strictObject({
  items: z.array(productCohortSchema).max(cohortListLimit),
  nextCursor: z.uuid().nullable(),
});

/**
 * Текущие потоки продуктов для страницы продукта и бота. Поток — публичный факт, он не зависит
 * от читателя; цену и продажу страница берёт из предложений, а не отсюда. Цена после старта
 * здесь только для витрины: страница показывает её зачёркнутой, а списание её не читает.
 */
export async function listProductCohorts(
  prisma: BillingPrismaClient,
  productId?: string,
  cursor?: string,
): Promise<
  PricingResult<
    z.infer<typeof productCohortsSchema>,
    "invalid_request" | "dependency_unavailable"
  >
> {
  const parsed = productCohortsQuerySchema.safeParse({ productId, cursor });
  if (!parsed.success) return failure("invalid_request");
  try {
    const rows = await prisma.billingProductCohort.findMany({
      ...(parsed.data.productId === undefined
        ? parsed.data.cursor === undefined
          ? {}
          : { where: { productId: { gt: parsed.data.cursor } } }
        : { where: { productId: parsed.data.productId } }),
      orderBy: { productId: "asc" },
      take: cohortListLimit + 1,
    });
    return {
      ok: true,
      value: productCohortsSchema.parse({
        items: rows.slice(0, cohortListLimit).map((row) => ({
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
          rows.length > cohortListLimit
            ? (rows[cohortListLimit - 1]?.productId ?? null)
            : null,
      }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "listProductCohorts" },
      error,
      failure("dependency_unavailable"),
    );
  }
}
