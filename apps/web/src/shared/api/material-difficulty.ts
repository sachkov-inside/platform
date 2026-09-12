import { z } from "zod";

export const materialDifficulties = ["basic", "intermediate", "advanced"] as const;
export const materialDifficultySchema = z.enum(materialDifficulties);
export type MaterialDifficulty = z.infer<typeof materialDifficultySchema>;

/**
 * Что урок обещает: черновик принимает до четырёх пунктов, публикация — ноль либо два-четыре.
 * Правило принадлежит backend; здесь лежит его зеркало для формы и подписи, чтобы редактор не
 * держал те же числа в трёх местах.
 */
export const MATERIAL_OUTCOMES = {
  maxCount: 4,
  maxLength: 200,
  minPublishedCount: 2,
} as const;
