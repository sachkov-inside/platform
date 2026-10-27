import { z } from "zod";

const operationId = z.uuid();
const revision = z.int().positive();
const instant = z.iso.datetime({ offset: true });
const count = z.int().nonnegative();

/** Значение скидки в команде `promotions.save`: те же поля, что у Promotion без редакции и архива. */
export const promotionValueSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),
  percent: z.int().min(1).max(100),
  code: z.string().trim().min(1).max(100).nullable(),
  startsAt: instant,
  endsAt: instant,
  productIds: z.array(z.uuid()).max(100),
  usageLimit: revision.nullable(),
});
export type PromotionValue = z.infer<typeof promotionValueSchema>;

export const savePromotionInputSchema = z.strictObject({
  operationId,
  /** Редакция из списка: без неё команда создаёт новую скидку. */
  expectedRevision: revision.optional(),
  value: promotionValueSchema,
});
export const archivePromotionInputSchema = z.strictObject({
  operationId,
  expectedRevision: revision,
  id: z.uuid(),
});
export const listPromotionsInputSchema = z.strictObject({
  operationId,
  archived: z.boolean().optional(),
  productId: z.uuid().optional(),
  questionnaire: z.boolean().optional(),
  cursor: z.uuid().optional(),
  limit: z.int().min(1).max(100),
});

/**
 * Скидка в списке владельца (`promotions.list`). `usedCount` считает применения по правилу лимита,
 * `legacy` отмечает архивную скидку прежней области: её пустой `productIds` не значит «все
 * продукты».
 */
export const promotionListItemSchema = z.object({
  id: z.uuid(),
  revision,
  name: z.string(),
  percent: z.int().min(1).max(100),
  code: z.string().nullable(),
  startsAt: instant,
  endsAt: instant,
  productIds: z.array(z.uuid()),
  usageLimit: revision.nullable(),
  archived: z.boolean(),
  usedCount: count,
  questionnaire: z.boolean(),
  legacy: z.boolean(),
});
export type PromotionListItem = z.infer<typeof promotionListItemSchema>;

const envelope = <Schema extends z.ZodType>(result: Schema) =>
  z.object({ operationRef: z.uuid(), result });

export const promotionsOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("promotions"),
    items: z.array(promotionListItemSchema),
    nextCursor: z.uuid().nullable(),
  }),
);
export const promotionCatalogOutcomeSchema = envelope(
  z.object({
    outcome: z.literal("catalog"),
    value: z.object({ id: z.uuid(), revision, archived: z.boolean() }),
  }),
);

/** Скидка респондентам анкеты (#815): только сводка, импорт и выдача из админки убраны. */
export const respondentsStatusInputSchema = z.strictObject({ operationId });
export const respondentsViewSchema = z.object({
  total: count,
  issued: count,
  purchased: count,
  respondents: z.array(
    z.object({
      username: z.string(),
      issuedAt: z.iso.datetime({ offset: true }).nullable(),
      purchased: z.boolean(),
    }),
  ),
});
export type RespondentsView = z.infer<typeof respondentsViewSchema>;
export const respondentsOutcomeSchema = envelope(
  z.object({ outcome: z.literal("respondents"), value: respondentsViewSchema }),
);

export type SavePromotionInput = z.infer<typeof savePromotionInputSchema>;
export type ArchivePromotionInput = z.infer<typeof archivePromotionInputSchema>;
export type ListPromotionsInput = z.infer<typeof listPromotionsInputSchema>;
