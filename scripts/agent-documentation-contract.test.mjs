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
  checkHarnessRouting,
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

describe("harness routing contract", () => {
  it("accepts original specification discovery and native manual-skill policy", () => {
    assert.deepEqual(checkHarnessRouting(repositoryRoot), []);
  });

  it("rejects a missing original skill and broken workflow pointers", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-routing-"));
    try {
      writeFileSync(
        join(root, "AGENTS.md"),
        "[run](.agents/skills/missing/SKILL.md)\n",
      );
      writeFileSync(
        join(root, "WORKFLOW.md"),
        "[run](.agents/skills/missing/SKILL.md)\n",
      );
      const failures = checkHarnessRouting(root);
      assert.ok(
        failures.some((failure) =>
          failure.includes("original specification skill is missing"),
        ),
      );
      assert.ok(
        failures.some((failure) =>
          failure.startsWith("WORKFLOW.md: local pointer"),
        ),
      );
      assert.ok(failures.some((failure) => failure.includes("owner-invoked")));
      assert.ok(
        failures.some((failure) => failure.includes("integration contract")),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a retained coordinator, stale skill pointer and implicit manual invocation", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-routing-"));
    try {
      const skill = join(root, ".agents/skills/implement-spec");
      mkdirSync(join(skill, "agents"), { recursive: true });
      mkdirSync(join(root, ".agents/skills/orchestrate"), { recursive: true });
      writeFileSync(
        join(root, "AGENTS.md"),
        "[run](.agents/skills/implement-spec/SKILL.md)\n",
      );
      writeFileSync(
        join(root, "WORKFLOW.md"),
        "A specification uses one integration branch and final PR\n",
      );
      writeFileSync(join(root, ".agents/skills/PIPELINE.md"), "Pipeline\n");
      writeFileSync(
        join(skill, "SKILL.md"),
        "---\ndisable-model-invocation: true\n---\n[old](../orchestrate/SKILL.md)\n",
      );

      let failures = checkHarnessRouting(root);
      assert.ok(failures.some((failure) => failure.includes("remains active")));
      assert.ok(
        failures.some((failure) =>
          failure.includes("superseded orchestrate pointer"),
        ),
      );
      assert.ok(failures.some((failure) => failure.includes("local pointer")));
      assert.ok(
        failures.some((failure) =>
          failure.includes("native implicit-invocation policy"),
        ),
      );

      writeFileSync(
        join(skill, "agents/openai.yaml"),
        "policy:\n  allow_implicit_invocation: true\n",
      );
      failures = checkHarnessRouting(root);
      assert.ok(
        failures.some((failure) =>
          failure.includes("native implicit-invocation policy"),
        ),
      );

      rmSync(join(root, ".agents/skills/orchestrate"), { recursive: true });
      writeFileSync(
        join(skill, "SKILL.md"),
        "---\ndisable-model-invocation: true\n---\nOriginal body\n",
      );
      writeFileSync(
        join(skill, "agents/openai.yaml"),
        "policy:\n  allow_implicit_invocation: false\n",
      );
      assert.deepEqual(checkHarnessRouting(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
