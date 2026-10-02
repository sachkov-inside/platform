// @ts-check
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  checkDocumentation,
  codingStandardsLineLimit,
  documentationWarnings,
  extractLocalMarkdownTargets,
  processContractLineLimit,
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

  it("warns only when a coding standard is longer than the limit", () => {
    const root = mkdtempSync(join(tmpdir(), "docs-check-"));
    try {
      const standards = join(root, "CODING_STANDARDS.md");
      writeFileSync(standards, "rule\n".repeat(codingStandardsLineLimit));
      assert.deepEqual(documentationWarnings(root), []);

      writeFileSync(standards, "rule\n".repeat(codingStandardsLineLimit + 1));
      assert.deepEqual(documentationWarnings(root), [
        `CODING_STANDARDS.md: ${codingStandardsLineLimit + 1} lines, more than ${codingStandardsLineLimit}; open a task to turn rules into checks`,
      ]);

      mkdirSync(join(root, "apps/web"), { recursive: true });
      writeFileSync(standards, "rule\n");
      writeFileSync(
        join(root, "apps/web/CODING_STANDARDS.md"),
        "rule\n".repeat(codingStandardsLineLimit + 2),
      );
      assert.deepEqual(documentationWarnings(root), [
        `apps/web/CODING_STANDARDS.md: ${codingStandardsLineLimit + 2} lines, more than ${codingStandardsLineLimit}; open a task to turn rules into checks`,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  for (const contract of ["AGENTS.md", "WORKFLOW.md"]) {
    it(`warns about ${contract} longer than the limit and still passes`, () => {
      const root = mkdtempSync(join(tmpdir(), "docs-check-"));
      try {
        writeFileSync(
          join(root, contract),
          "rule\n".repeat(processContractLineLimit),
        );
        assert.deepEqual(documentationWarnings(root), []);
        rmSync(join(root, contract));

        for (const name of readdirSync(repositoryRoot)) {
          if (name !== contract) {
            symlinkSync(join(repositoryRoot, name), join(root, name));
          }
        }
        const current = readFileSync(join(repositoryRoot, contract), "utf8");
        writeFileSync(
          join(root, contract),
          current + "rule\n".repeat(processContractLineLimit),
        );
        const lines = current.split("\n").length - 1 + processContractLineLimit;

        assert.equal(
          documentationWarnings(root).includes(
            `${contract}: ${lines} lines, more than ${processContractLineLimit}; shorten the process contract`,
          ),
          true,
        );
        assert.deepEqual(checkDocumentation(root), []);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
