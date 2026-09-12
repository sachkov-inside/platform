import { z } from "zod";

/**
 * Факты урока на проводе: насколько он сложен и что обещает. Правило принадлежит backend; здесь
 * лежит его зеркало для формы редактора и подписей, чтобы редактор не держал те же значения в
 * трёх местах. Паритет с контрактом проверяет `material-lesson-facts.test.ts`.
 */

export const materialDifficulties = ["basic", "intermediate", "advanced"] as const;
export const materialDifficultySchema = z.enum(materialDifficulties);
export type MaterialDifficulty = z.infer<typeof materialDifficultySchema>;

/** Что урок обещает: черновик принимает до четырёх пунктов, публикация — ноль либо два-четыре. */
export const MATERIAL_OUTCOMES = {
  maxCount: 4,
  maxLength: 200,
  minPublishedCount: 2,
} as const;
