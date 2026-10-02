// @ts-check
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  checkDocumentation,
  codingStandardsLineLimit,
  documentationWarnings,
  extractLocalMarkdownTargets,
} from "./check-agent-documentation.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("agent documentation contract", () => {
  it("keeps current agent pointers and Materials documentation consistent", () => {
    assert.deepEqual(checkDocumentation(repositoryRoot), []);
  });

  it("extracts repository pointers without treating external links as files", () => {
    const markdown = [
      "[local](../GLOSSARY.md#material)",
      "[external](https://example.com/reference)",
      "[anchor](#completion)",
      "[route](/materials/example)",
    ].join("\n");

    assert.deepEqual(extractLocalMarkdownTargets(markdown), ["../GLOSSARY.md"]);
  });

  it("warns only when the root coding standard is longer than the limit", () => {
    const root = mkdtempSync(join(tmpdir(), "docs-check-"));
    try {
      const standards = join(root, "CODING_STANDARDS.md");
      writeFileSync(standards, "rule\n".repeat(codingStandardsLineLimit));
      assert.deepEqual(documentationWarnings(root), []);

      writeFileSync(standards, "rule\n".repeat(codingStandardsLineLimit + 1));
      assert.deepEqual(documentationWarnings(root), [
        `CODING_STANDARDS.md: ${codingStandardsLineLimit + 1} lines, more than ${codingStandardsLineLimit}; open a task to turn rules into checks`,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
