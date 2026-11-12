import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readAiModelsReferenceFile } from "../../src/modules/ai-models/ai-models-reference-file.js";

// The owner publishes the Справочник from this file, so every change to it must still import.
const current: unknown = JSON.parse(
  readFileSync("content/ai-models-reference.json", "utf8"),
);

describe("the current Справочник", () => {
  it("passes the import's whole-file check, answer budget included", () => {
    const result = readAiModelsReferenceFile(current);

    expect(result.status === "rejected" ? result.errors : []).toEqual([]);
  });
});
