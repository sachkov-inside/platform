import type { MaterialDifficulty } from "@/shared/api/material-lesson-facts";

/** Названия уровней сложности в редакторе; Reader не показывает сложность. */
const labels: Readonly<Record<MaterialDifficulty, string>> = {
  advanced: "Продвинутый",
  basic: "Базовый",
  intermediate: "Средний",
};

export function materialDifficultyLabel(
  difficulty: MaterialDifficulty,
): string {
  return labels[difficulty];
}
