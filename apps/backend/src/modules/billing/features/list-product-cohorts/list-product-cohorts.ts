import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { productCohortSchema } from "../../domain/product-cohort.js";
import { failure, type PricingResult } from "../../domain/pricing.js";

/** Сколько продуктов с потоком читается за раз: у каталога их единицы, граница только от сбоя. */
const cohortListLimit = 100;

export const productCohortsSchema = z.strictObject({
  items: z.array(productCohortSchema).max(cohortListLimit),
});

/**
 * Текущие потоки продуктов для страницы продукта и бота. Поток — публичный факт, он не зависит
 * от читателя; цену и продажу страница берёт из предложений, а не отсюда.
 */
export async function listProductCohorts(
  prisma: BillingPrismaClient,
): Promise<
  PricingResult<z.infer<typeof productCohortsSchema>, "dependency_unavailable">
> {
  try {
    const rows = await prisma.billingProductCohort.findMany({
      orderBy: { productId: "asc" },
      take: cohortListLimit,
    });
    return {
      ok: true,
      value: productCohortsSchema.parse({
        items: rows.map((row) => ({
          productId: row.productId,
          revision: row.revision,
          name: row.name,
          stage: row.stage,
          startsOn: row.startsOn?.toISOString().slice(0, 10) ?? null,
          nextEvent: row.nextEvent,
        })),
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
