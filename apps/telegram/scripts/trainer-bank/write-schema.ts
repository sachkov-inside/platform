import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  TRAINER_BANK_FILE_LIMITS,
  trainerBankFileSchema,
} from "../../src/modules/trainer/trainer-bank-file.js";

// Writes the published JSON Schema of the Bank file from the schema the import checks with.
// The private repository of questions validates its file against the published copy.
export const trainerBankSchemaFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/integrations/trainer-bank-v1.schema.json",
);

export function trainerBankJsonSchemaText(): string {
  const { $schema, ...shape } = z.toJSONSchema(trainerBankFileSchema, {
    target: "draft-2020-12",
  });
  return (
    JSON.stringify(
      {
        $schema,
        $id: "https://github.com/sachkov-inside/platform/blob/main/apps/telegram/docs/integrations/trainer-bank-v1.schema.json",
        title: "Файл Банка вопросов Тренажёра, версия 1",
        description:
          "Схема проверяет форму файла. Лимиты из x-limits и остальные правила импорт проверяет сам, они описаны в trainer-bank-v1.md.",
        "x-limits": TRAINER_BANK_FILE_LIMITS,
        ...shape,
      },
      null,
      2,
    ) + "\n"
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(trainerBankSchemaFile, trainerBankJsonSchemaText());
  process.stdout.write(`Wrote ${trainerBankSchemaFile}\n`);
}
