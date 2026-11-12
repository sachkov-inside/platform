import { readFileSync } from "node:fs";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  aiModelsReferenceJsonSchemaText,
  aiModelsReferenceSchemaFile,
} from "../../scripts/ai-models-reference/write-schema.js";
import { readAiModelsReferenceFile } from "../../src/modules/ai-models/ai-models-reference-file.js";
import { syntheticAiModelsReference } from "../support/synthetic-ai-models-reference.js";

const published = readFileSync(aiModelsReferenceSchemaFile, "utf8");
const publishedSchema = z
  .record(z.string(), z.unknown())
  .parse(JSON.parse(published));
const example: unknown = JSON.parse(
  readFileSync("docs/integrations/ai-models-reference-v1.example.json", "utf8"),
);

function publishedValidator() {
  const ajv = new Ajv2020({ strict: false });
  addFormats.default(ajv);
  return ajv.compile(publishedSchema);
}

describe("published Справочник file schema", () => {
  it("equals the schema generated from the one the import checks with", () => {
    expect(published).toBe(aiModelsReferenceJsonSchemaText());
  });

  it("publishes the limits the import applies", () => {
    expect(publishedSchema["x-limits"]).toEqual({
      aboutLineCharacters: 90,
      serviceNameCharacters: 24,
      planNameCharacters: 20,
      modelNameCharacters: 24,
      familyCharacters: 16,
      summaryCharacters: 50,
      agentNameCharacters: 24,
      agentReasonCharacters: 50,
      alternativesCharacters: 90,
      noticeCharacters: 50,
      vendorWordingCharacters: 50,
      noteCharacters: 30,
      favoriteGroupTitleCharacters: 20,
      banRiskTextCharacters: 60,
      badgeTextCharacters: 60,
      adviceCharacters: 60,
      betterPickReasonCharacters: 30,
      measuredAccountsMin: 5,
      widgetDataBytes: 1024,
      widgetRequestBytes: 64,
    });
  });

  it("accepts the published synthetic example, and so does the import check", () => {
    const validate = publishedValidator();

    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    expect(readAiModelsReferenceFile(example).status).toBe("valid");
  });

  it("publishes the synthetic Справочник the tests use", () => {
    expect(example).toEqual(syntheticAiModelsReference());
  });

  it("rejects a model with an unknown field or without a required one", () => {
    const validate = publishedValidator();
    const typo = syntheticAiModelsReference();
    Object.assign(typo.models[0] ?? {}, { sumary: "Опечатка" });
    const missing = syntheticAiModelsReference();
    Reflect.deleteProperty(missing.models[0] ?? {}, "summary");

    expect(validate(typo)).toBe(false);
    expect(validate(missing)).toBe(false);
  });
});
