import { z } from "zod";
import { idSchema, promotionSchema } from "../../domain/pricing.js";
import { listCursorSchema } from "../../shared/list-cursor.js";

/**
 * Фильтр списка скидок. `archived` и `questionnaire` выбирают одну сторону: по умолчанию видны
 * действующие записи владельца без анкетных скидок. `productId` выбирает скидки, которые
 * применяются к продукту: названные с ним и скидки на все продукты. `cursor` продолжает только
 * список с тем же фильтром.
 */
export const promotionsListShape = {
  archived: z.boolean().default(false),
  productId: idSchema.optional(),
  questionnaire: z.boolean().default(false),
  cursor: listCursorSchema.optional(),
  limit: z.int().min(1).max(100).default(50),
};

/**
 * Скидка в списке владельца. `usedCount` считает применения по тому же правилу, что лимит
 * использования. `legacy` отмечает архивную скидку, чья прежняя область (предложения или
 * варианты оплаты) не перешла на продукты: её пустой `productIds` не значит «все продукты».
 */
export const promotionListItemSchema = promotionSchema.extend({
  usedCount: z.int().nonnegative(),
  questionnaire: z.boolean(),
  legacy: z.boolean(),
});
export type PromotionListItem = z.infer<typeof promotionListItemSchema>;
