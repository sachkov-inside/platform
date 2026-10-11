// @ts-check
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { z } from "zod";

import { termDefinitionSchema } from "@inside/material-blocks";
import { prepareTermReferences } from "./term-references.mjs";

const definitionsPath = new URL(
  "../../docs/contracts/authoring-terms-v1/example/definitions.json",
  import.meta.url,
);

test("the portable five-term fixture passes the shared authoring contract", async () => {
  const definitions = z
    .array(termDefinitionSchema)
    .parse(JSON.parse(await readFile(definitionsPath, "utf8")));
  const resolve = prepareTermReferences(
    definitions.map((definition) => ({
      definition,
      publicationState: "draft",
      available: true,
    })),
    { allowUnpublished: true },
  );
  assert.deepEqual(
    ["Деплой", "CI", "Релиз", "Образ", "Окружение"].map(resolve),
    [
      { kind: "term", termId: "44300000-0000-4000-8000-000000000001" },
      { kind: "term", termId: "44300000-0000-4000-8000-000000000002" },
      { kind: "term", termId: "44300000-0000-4000-8000-000000000003" },
      { kind: "term", termId: "44300000-0000-4000-8000-000000000004" },
      { kind: "term", termId: "44300000-0000-4000-8000-000000000005" },
    ],
  );
});

test("card data cannot carry a Material body, publication flag or local vault path", () => {
  const definition = {
    id: "44300000-0000-4000-8000-000000000001",
    title: "Деплой",
    aliases: ["deploy"],
    definition:
      "Развёртывание выбранной версии приложения в конкретном окружении — например, на тестовом сервере",
  };
  for (const extra of [
    { body: { schemaVersion: 1, doc: { type: "doc" } } },
    { publicationState: "published" },
    { vaultPath: "/author/vault/Деплой.md" },
    { available: true },
  ]) {
    assert.equal(
      termDefinitionSchema.safeParse({ ...definition, ...extra }).success,
      false,
    );
  }
  assert.equal(
    termDefinitionSchema.safeParse({
      ...definition,
      materialId: "44300000-0000-4000-8000-000000000101",
      example: "Тестовый пример изолированного контракта.",
    }).success,
    true,
  );
  assert.equal(
    termDefinitionSchema.safeParse({
      ...definition,
      materialId: "../detail.md",
    }).success,
    false,
  );
});
