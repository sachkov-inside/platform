// @ts-check
// Shared by the authoring tests; it is not a test file itself.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { authoringImportContract } from "../../apps/backend/src/modules/materials/domain/authoring-import-contract.ts";

/**
 * The item a test expects at a position; a missing item fails the test.
 *
 * @template T
 * @param {readonly T[]} items
 * @param {number} index
 * @returns {T}
 */
export function itemAt(items, index) {
  const item = items[index];
  assert.ok(item !== undefined, `Expected an item at position ${index}`);
  return item;
}

/**
 * The value a test expects under a key; a missing value fails the test.
 *
 * @template K, V
 * @param {ReadonlyMap<K, V>} map
 * @param {K} key
 * @returns {V}
 */
export function valueAt(map, key) {
  const value = map.get(key);
  assert.ok(value !== undefined, `Expected a value for ${String(key)}`);
  return value;
}

/**
 * The entry a test expects under a record key; a missing entry fails the test.
 *
 * @template V
 * @param {Readonly<Record<string, V>>} record
 * @param {string} key
 * @returns {V}
 */
export function entryAt(record, key) {
  const entry = record[key];
  assert.ok(entry !== undefined, `Expected an entry for ${key}`);
  return entry;
}

// The journal file as tests read and edit it. Only the fields tests touch are typed; every other
// field passes through, so a test that writes the journal back changes nothing else.
const journalFileSchema = z
  .object({
    materials: z.record(
      z.string(),
      z.object({ contentVersion: z.number() }).passthrough(),
    ),
    products: z.record(z.string(), z.object({}).passthrough()),
    operations: z.record(z.string(), z.unknown()),
    resources: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const journalOperationSchema = z
  .object({
    status: z.string(),
    request: z.object({ body: z.unknown() }).passthrough(),
    error: z.object({ status: z.number() }).passthrough().optional(),
  })
  .passthrough();

/**
 * @param {string} directory The sync state directory that holds `journal.json`.
 */
export async function readJournalFile(directory) {
  return journalFileSchema.parse(
    JSON.parse(await readFile(join(directory, "journal.json"), "utf8")),
  );
}

/**
 * The request operation a test expects under a journal key.
 *
 * @param {z.infer<typeof journalFileSchema>} journal
 * @param {string} key
 */
export function operationAt(journal, key) {
  return journalOperationSchema.parse(entryAt(journal.operations, key));
}

/**
 * The durable receipts a test expects the journal to hold.
 *
 * @param {z.infer<typeof journalFileSchema>} journal
 */
export function resourcesOf(journal) {
  assert.ok(journal.resources !== undefined, "Expected journal resources");
  return journal.resources;
}

/** Test doubles read the reservation a sync sends before any Material exists. */
export const reservationBodySchema = z
  .object({
    source: z.object({ id: z.string(), path: z.string() }).passthrough(),
  })
  .passthrough();

/** Synthetic current receiver used by authoring transport doubles.
 * @param {string} mode */
export function currentEnvironment(mode) {
  return {
    mode: z.enum(["development", "test", "production"]).parse(mode),
    contract: {
      version: authoringImportContract.version,
      packageFeatures: [...authoringImportContract.packageFeatures],
    },
  };
}

/**
 * Reader blocks exactly as the Content exporter emits them (content-studio#86 `exercise-v1`,
 * #87 `step-breaks-v1`): Markdown fragments with a quiz, a match and an order in place, and a
 * step break between two parts. The narrative carries the heading `## Раздел`.
 *
 * @returns {import("@inside/material-blocks").ContentReaderBlock[]}
 */
export function contentExerciseBlocks() {
  return [
    { kind: "markdown", markdown: "## Раздел\n\nДо упражнения\n" },
    {
      kind: "quiz",
      id: "rag-wrong-platform",
      reveal: "after-answer",
      contextMarkdown: "Ситуация.",
      questionMarkdown: "На каком шаге ошибка?",
      selectionMode: "single",
      options: [
        {
          id: "embed",
          markdown: "Эмбеддинг.",
          correct: false,
          explanationMarkdown: "Почему нет.",
        },
        { id: "prompt", markdown: "Промпт.", correct: true },
      ],
      dontKnow: {
        explanationMarkdown: "Перечитай [раздел](#раздел).",
        reviewLinks: ["#раздел"],
      },
    },
    { kind: "step-break", label: "Что дальше?" },
    {
      kind: "match",
      id: "roles",
      reveal: "none",
      questionMarkdown: "Кто за что отвечает?",
      mode: "pairs",
      rows: ["plan", "code", "test"].map((id) => ({
        id,
        markdown: `Строка ${id}.`,
        answerId: `${id}-role`,
        explanationMarkdown: `Почему ${id}.`,
      })),
      choices: ["plan", "code", "test"].map((id) => ({
        id: `${id}-role`,
        markdown: `Роль ${id}`,
      })),
    },
    {
      kind: "order",
      id: "pipeline",
      reveal: "none",
      questionMarkdown: "В каком порядке?",
      steps: ["spec", "code", "ship"].map((id) => ({
        id,
        markdown: `Шаг ${id}.`,
        explanationMarkdown: `Почему ${id} здесь.`,
      })),
    },
    { kind: "markdown", markdown: "## Дальше\n\nПосле упражнений\n" },
  ];
}
