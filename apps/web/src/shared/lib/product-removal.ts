import { z } from "zod";

/**
 * Руководство с действующими держателями права, из которого автор убирает опубликованный
 * материал. Сервер отказывает такому сохранению, пока снятие не подтверждено.
 */
export const productRemovalSchema = z
  .object({
    productId: z.uuid(),
    holders: z.number().int().positive(),
    name: z.string(),
  })
  .strict();

export type ProductRemoval = z.infer<typeof productRemovalSchema>;

/** Отказ сервера, который требует подтвердить снятие; иначе `null`. */
export function productRemovalsFromProblem(
  problem: unknown,
): readonly ProductRemoval[] | null {
  const parsed = z
    .looseObject({
      code: z.literal("product_removal_confirmation_required"),
      products: z.array(productRemovalSchema).min(1),
    })
    .safeParse(problem);
  return parsed.success ? parsed.data.products : null;
}
