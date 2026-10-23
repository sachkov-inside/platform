import type { CoverageCatalog } from "../../../account-rights/index.js";
import { productIdFromCapability } from "@inside/access-capabilities";
import { z } from "zod";
import { hasText } from "../../../../infrastructure/contracts/text.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { accessCapabilitySchema } from "../../../account-rights/index.js";
import {
  failure,
  idSchema,
  priceSnapshotSchema,
  type PricingResult,
} from "../../domain/pricing.js";
import type { SaleCapability } from "../../domain/sale-capability.js";
import { paymentAdmission } from "../../shared/payment-admission.js";
import { selectPricesForOptions } from "../../shared/select-price.js";

export const listOffersSchema = z.strictObject({
  cursor: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Витрина подписки и витрина руководства спрашивают разные способы оплаты одного каталога. */
  mode: z.literal("one_time").optional(),
  /** Что именно открывает предложение: страница руководства спрашивает своё право. */
  capability: accessCapabilitySchema.optional(),
});
export const offersPageSchema = z.strictObject({
  items: z.array(priceSnapshotSchema),
  nextCursor: idSchema.nullable(),
});
export interface ListOffersOptions {
  readonly contentCatalog?: CoverageCatalog | undefined;
  /** Публичная витрина видит только предложения, включённые в продажу; владелец — весь непустой каталог. */
  readonly publishedOnly?: boolean;
  readonly sale?: SaleCapability;
}
export async function listOffers(
  prisma: BillingPrismaClient,
  input: unknown,
  clock: () => Date,
  options: ListOffersOptions = {},
): Promise<
  PricingResult<
    z.infer<typeof offersPageSchema>,
    "invalid_request" | "dependency_unavailable"
  >
> {
  const parsed = listOffersSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_request");
  try {
    const { cursor, limit, capability } = parsed.data;
    const productId =
      capability === undefined ? null : productIdFromCapability(capability);
    const rows = await prisma.billingProductPrice.findMany({
      where: {
        archived: false,
        ...(options.publishedOnly === true ? { published: true } : {}),
        ...(productId === null ? {} : { productId }),
        ...(hasText(cursor) ? { AND: [{ productId: { gt: cursor } }] } : {}),
      },
      orderBy: { productId: "asc" },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const items = [];
    const now = clock();
    const prices = await selectPricesForOptions(prisma, page, now, undefined, {
      allowUnpublished: options.publishedOnly !== true,
    });
    const metadata =
      options.publishedOnly !== true
        ? undefined
        : await options.contentCatalog?.resolveMany(
            page.map((row) => ({
              productIds: [row.productId],
              materialIds: [],
            })),
          );
    for (const [index, row] of page.entries()) {
      if (
        options.publishedOnly === true &&
        metadata?.[index]?.some(
          (entry) => entry.kind === "product" && entry.available,
        ) !== true
      )
        continue;
      const price = prices.get(row.productId);
      if (price === undefined) continue;
      if (
        price.ok &&
        (options.publishedOnly !== true ||
          paymentAdmission({
            snapshot: price.value,
            sale: options.sale ?? { payments: false },
          }).ok)
      )
        items.push(price.value);
    }
    return {
      ok: true,
      value: {
        items,
        nextCursor:
          rows.length > limit ? (page.at(-1)?.productId ?? null) : null,
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "billing", operation: "listOffers" },
      error,
      failure("dependency_unavailable"),
    );
  }
}
