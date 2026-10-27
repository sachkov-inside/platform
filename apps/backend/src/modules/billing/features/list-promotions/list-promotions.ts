import type {
  BillingPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import {
  ownerFailure,
  type OwnerOperation,
  type OwnerResult,
} from "../../domain/owner-operations.js";
import { promotionUsage } from "../../shared/promotion-usage.js";
import {
  promotionListItemSchema,
  type PromotionListItem,
} from "./list-promotions.contract.js";

type ListPromotionsCommand = Extract<
  OwnerOperation,
  { operation: "promotions.list" }
>;

/**
 * Список скидок владельца от поздних к ранним по началу действия, затем по идентификатору. Право
 * `billing:manage` проверяет `BillingOperations`. Анкетность скидки неизменна, поэтому cursor
 * обязан лежать на своей стороне; архив и продукты меняются, и позиция такой скидки остаётся
 * допустимым продолжением.
 */
export async function listPromotions(
  prisma: BillingPrismaClient,
  command: ListPromotionsCommand,
): Promise<OwnerResult> {
  const side: Prisma.BillingPromotionWhereInput = command.questionnaire
    ? { surveyRespondent: { isNot: null } }
    : { surveyRespondent: { is: null } };
  const after =
    command.cursor === undefined
      ? null
      : await prisma.billingPromotion.findFirst({
          where: { AND: [{ id: command.cursor }, side] },
          select: { id: true, startsAt: true },
        });
  if (command.cursor !== undefined && after === null)
    return ownerFailure("invalid_request");
  const rows = await prisma.billingPromotion.findMany({
    where: {
      AND: [
        side,
        { archived: command.archived },
        command.productId === undefined
          ? {}
          : {
              // Скидка применяется к продукту, названному в ней, или ко всем продуктам.
              OR: [
                { productIds: { has: command.productId } },
                { productIds: { isEmpty: true }, NOT: legacyScope },
              ],
            },
        after === null
          ? {}
          : {
              OR: [
                { startsAt: { lt: after.startsAt } },
                { startsAt: after.startsAt, id: { lt: after.id } },
              ],
            },
      ],
    },
    orderBy: [{ startsAt: "desc" }, { id: "desc" }],
    take: command.limit + 1,
  });
  const page = rows.slice(0, command.limit);
  const usage = await promotionUsage(
    prisma,
    page.map((row) => row.id),
  );
  return {
    ok: true,
    operationRef: command.operationId,
    result: {
      outcome: "promotions",
      items: page.map((row): PromotionListItem =>
        promotionListItemSchema.parse({
          id: row.id,
          revision: row.revision,
          name: row.name,
          percent: row.percent,
          code: row.code,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          productIds: row.productIds,
          usageLimit: row.usageLimit,
          archived: row.archived,
          usedCount: usage.get(row.id) ?? 0,
          // Every row of the page lies on the side the filter selected.
          questionnaire: command.questionnaire,
          legacy: isLegacyScope(row),
        }),
      ),
      nextCursor:
        rows.length > command.limit ? (page.at(-1)?.id ?? null) : null,
    },
  };
}

/** Отбор той же архивной прежней области, что `isLegacyScope`, для фильтра по продукту. */
const legacyScope: Prisma.BillingPromotionWhereInput = {
  archived: true,
  productIds: { isEmpty: true },
  OR: [
    { legacyOfferIds: { isEmpty: false } },
    { legacyPaymentOptionIds: { isEmpty: false } },
  ],
};

/**
 * Миграция 0108 архивировала скидку, чью прежнюю область по предложениям или вариантам оплаты
 * нельзя было перенести на продукты, и оставила ей пустой `productIds`. Такая пустота не значит
 * «все продукты». Действующая скидка с пустым `productIds` применяется ко всем продуктам.
 */
function isLegacyScope(row: {
  readonly archived: boolean;
  readonly productIds: readonly string[];
  readonly legacyOfferIds: readonly string[];
  readonly legacyPaymentOptionIds: readonly string[];
}): boolean {
  return (
    row.archived &&
    row.productIds.length === 0 &&
    (row.legacyOfferIds.length > 0 || row.legacyPaymentOptionIds.length > 0)
  );
}
