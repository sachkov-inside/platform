import { readFileSync } from "node:fs";

import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  trainerBankJsonSchemaText,
  trainerBankSchemaFile,
} from "../../scripts/trainer-bank/write-schema.js";
import { readTrainerBankFile } from "../../src/modules/trainer/trainer-bank-file.js";
import { syntheticTrainerBank } from "../support/synthetic-trainer-bank.js";

const published = readFileSync(trainerBankSchemaFile, "utf8");
const publishedSchema = z
  .record(z.string(), z.unknown())
  .parse(JSON.parse(published));
const example: unknown = JSON.parse(
  readFileSync("docs/integrations/trainer-bank-v1.example.json", "utf8"),
);

function publishedValidator() {
  const ajv = new Ajv2020({ strict: false });
  addFormats.default(ajv);
  return ajv.compile(publishedSchema);
}

describe("published Bank file schema", () => {
  it("equals the schema generated from the one the import checks with", () => {
    expect(published).toBe(trainerBankJsonSchemaText());
  });

  it("publishes the limits the import applies", () => {
    expect(publishedSchema["x-limits"]).toEqual({
      topics: 9,
      topicNameCharacters: 40,
      questionTextCharacters: 160,
      optionTextsTogetherCharacters: 240,
      answerExplanationCharacters: 200,
      topicsDataBytes: 1024,
      progressDataBytes: 1024,
      questionDataBytes: 1024,
      answerExplanationDataBytes: 1024,
    });
  });

  it("accepts the published synthetic example, and so does the import check", () => {
    const validate = publishedValidator();

    expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
    expect(readTrainerBankFile(example).status).toBe("valid");
  });

  it("rejects a question with an unknown field or without a required one", () => {
    const validate = publishedValidator();
    const typo = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
    Object.assign(typo.questions[0] ?? {}, { explanaton: "Опечатка" });
    const missing = syntheticTrainerBank({ topics: 1, questionsPerTopic: 1 });
    Reflect.deleteProperty(missing.questions[0] ?? {}, "source");

    expect(validate(typo)).toBe(false);
    expect(validate(missing)).toBe(false);
  });
});
