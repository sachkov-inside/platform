import { z } from "zod";

export const materialDifficulties = ["basic", "intermediate", "advanced"] as const;
export const materialDifficultySchema = z.enum(materialDifficulties);
export type MaterialDifficulty = z.infer<typeof materialDifficultySchema>;
