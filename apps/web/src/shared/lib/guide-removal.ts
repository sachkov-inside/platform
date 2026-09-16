import { z } from "zod";

/**
 * Руководство с действующими держателями права, из которого автор убирает опубликованный
 * материал. Сервер отказывает такому сохранению, пока снятие не подтверждено.
 */
export const guideRemovalSchema = z
  .object({
    guideId: z.uuid(),
    holders: z.number().int().positive(),
    name: z.string(),
  })
  .strict();

export type GuideRemoval = z.infer<typeof guideRemovalSchema>;

/** Отказ сервера, который требует подтвердить снятие; иначе `null`. */
export function guideRemovalsFromProblem(problem: unknown): readonly GuideRemoval[] | null {
  const parsed = z
    .looseObject({
      code: z.literal("guide_removal_confirmation_required"),
      guides: z.array(guideRemovalSchema).min(1),
    })
    .safeParse(problem);
  return parsed.success ? parsed.data.guides : null;
}
