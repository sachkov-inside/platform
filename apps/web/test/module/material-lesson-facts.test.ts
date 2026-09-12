import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  MATERIAL_OUTCOMES,
  materialDifficulties,
} from "@/shared/api/material-lesson-facts";

/**
 * Правила фактов урока принадлежат backend, а редактор держит их зеркало: форма не может
 * импортировать домен другого приложения. Зеркало сверяется не с исходником, а с тем же
 * контрактом, из которого строится клиент, — тогда расхождение видно на проверке, а не в отказе
 * сохранения у автора.
 */
const contract: unknown = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "../../../backend/openapi/platform-api.json"),
    "utf8",
  ),
);

const outcomesSchema = z
  .object({
    items: z.object({ maxLength: z.number() }).loose(),
    maxItems: z.number(),
  })
  .loose();

const difficultySchema = z.object({ enum: z.array(z.string()) }).loose();

/** Каждое место контракта, где объявлены поля урока: их может быть несколько. */
function declaredLessonFacts(value: unknown): {
  readonly difficulties: readonly (readonly string[])[];
  readonly outcomes: readonly { maxCount: number; maxLength: number }[];
} {
  const difficulties: (readonly string[])[] = [];
  const outcomes: { maxCount: number; maxLength: number }[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const entries = Object.entries(node as Record<string, unknown>);
    for (const [key, child] of entries) {
      if (key === "outcomes") {
        const parsed = outcomesSchema.safeParse(child);
        if (parsed.success) {
          outcomes.push({
            maxCount: parsed.data.maxItems,
            maxLength: parsed.data.items.maxLength,
          });
        }
      }
      if (key === "difficulty") {
        const declared = difficultyValues(child);
        if (declared !== undefined) difficulties.push(declared);
      }
      walk(child);
    }
  };
  walk(value);
  return { difficulties, outcomes };
}

function difficultyValues(node: unknown): readonly string[] | undefined {
  const direct = difficultySchema.safeParse(node);
  if (direct.success) return direct.data.enum;
  const wrapped = z
    .object({ anyOf: z.array(z.unknown()) })
    .loose()
    .safeParse(node);
  if (!wrapped.success) return undefined;
  const values = wrapped.data.anyOf.flatMap((variant) => {
    const parsed = difficultySchema.safeParse(variant);
    return parsed.success ? parsed.data.enum : [];
  });
  return values.length === 0 ? undefined : values;
}

describe("Факты урока на проводе", () => {
  const declared = declaredLessonFacts(contract);

  it("повторяет уровни сложности из принятого контракта", () => {
    expect(declared.difficulties.length).toBeGreaterThan(0);
    for (const values of declared.difficulties) {
      expect(values).toEqual([...materialDifficulties]);
    }
  });

  it("повторяет пределы «Чему научишься» из принятого контракта", () => {
    expect(declared.outcomes.length).toBeGreaterThan(0);
    for (const limits of declared.outcomes) {
      expect(limits).toEqual({
        maxCount: MATERIAL_OUTCOMES.maxCount,
        maxLength: MATERIAL_OUTCOMES.maxLength,
      });
    }
  });
});
