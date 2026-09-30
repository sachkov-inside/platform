import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { guideCohortSchema } from "../../domain/guide-cohort.js";
import { failure, type PricingResult } from "../../domain/pricing.js";

/** Сколько продуктов с потоком читается за раз: у каталога их единицы, граница только от сбоя. */
const cohortListLimit = 100;

export const guideCohortsSchema = z.strictObject({
  items: z.array(guideCohortSchema).max(cohortListLimit),
});

/**
 * Текущие потоки продуктов для страницы продукта и бота. Поток — публичный факт, он не зависит
 * от читателя; цену и продажу страница берёт из предложений, а не отсюда.
 */
export async function listGuideCohorts(
  prisma: BillingPrismaClient,
): Promise<
  PricingResult<z.infer<typeof guideCohortsSchema>, "dependency_unavailable">
> {
  try {
    const rows = await prisma.billingGuideCohort.findMany({
      orderBy: { guideId: "asc" },
      take: cohortListLimit,
    });
    return {
      ok: true,
      value: guideCohortsSchema.parse({
        items: rows.map((row) => ({
          guideId: row.guideId,
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
      { module: "billing", operation: "listGuideCohorts" },
      error,
      failure("dependency_unavailable"),
    );
  }
}
