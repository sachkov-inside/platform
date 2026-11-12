import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  AI_MODELS_REFERENCE_LIMITS,
  aiModelsReferenceFileSchema,
} from "../../src/modules/ai-models/ai-models-reference-file.js";

// Writes the published JSON Schema of the Справочник file from the schema the import checks
// with. The owner's tools validate a file against the published copy before the import.
export const aiModelsReferenceSchemaFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/integrations/ai-models-reference-v1.schema.json",
);

export function aiModelsReferenceJsonSchemaText(): string {
  const { $schema, ...shape } = z.toJSONSchema(aiModelsReferenceFileSchema, {
    target: "draft-2020-12",
  });
  return (
    JSON.stringify(
      {
        $schema,
        $id: "https://github.com/sachkov-inside/platform/blob/main/apps/telegram/docs/integrations/ai-models-reference-v1.schema.json",
        title: "Файл Справочника раздела «ИИ-модели», версия 1",
        description:
          "Схема проверяет форму файла. Лимиты из x-limits и остальные правила импорт проверяет сам, они описаны в ai-models-reference-v1.md.",
        "x-limits": AI_MODELS_REFERENCE_LIMITS,
        ...shape,
      },
      null,
      2,
    ) + "\n"
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(
    aiModelsReferenceSchemaFile,
    aiModelsReferenceJsonSchemaText(),
  );
  process.stdout.write(`Wrote ${aiModelsReferenceSchemaFile}\n`);
}
