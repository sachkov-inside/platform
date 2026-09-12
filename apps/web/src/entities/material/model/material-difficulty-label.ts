import type { MaterialDifficulty } from "@/shared/api/material-difficulty";

/** Как сложность урока называется читателю: одно слово на уровень, в уроке и в программе. */
const labels: Readonly<Record<MaterialDifficulty, string>> = {
  advanced: "Продвинутый",
  basic: "Базовый",
  intermediate: "Средний",
};

export function materialDifficultyLabel(difficulty: MaterialDifficulty): string {
  return labels[difficulty];
}
