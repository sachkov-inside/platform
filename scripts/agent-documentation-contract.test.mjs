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
  checkHarnessConfiguration,
  checkHarnessRouting,
  checkStandardsReviewRouting,
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
  it("requires the correction contract from both session and workflow routing", () => {
    const root = mkdtempSync(join(tmpdir(), "correction-routing-"));
    try {
      for (const name of readdirSync(repositoryRoot)) {
        if (name !== "AGENTS.md" && name !== "WORKFLOW.md") {
          symlinkSync(join(repositoryRoot, name), join(root, name));
        }
      }
      for (const path of ["AGENTS.md", "WORKFLOW.md"]) {
        writeFileSync(
          join(root, path),
          readFileSync(join(repositoryRoot, path)),
        );
      }
      assert.deepEqual(checkHarnessRouting(root), []);
      for (const path of ["AGENTS.md", "WORKFLOW.md"]) {
        const content = readFileSync(join(root, path), "utf8");
        writeFileSync(
          join(root, path),
          content.replaceAll("docs/agents/owner-corrections.md", "#removed"),
        );
        assert.deepEqual(checkHarnessRouting(root), [
          `${path}: keep explicit owner corrections reachable`,
        ]);
        writeFileSync(join(root, path), content);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires review-stage standards routing in the root and rejects the former implementation gate", () => {
    const root = mkdtempSync(join(tmpdir(), "standards-routing-"));
    try {
      writeFileSync(
        join(root, "AGENTS.md"),
        "Before review, read [standards](CODING_STANDARDS.md).\n",
      );
      assert.deepEqual(checkStandardsReviewRouting(root), []);
      writeFileSync(
        join(root, "AGENTS.md"),
        "Before changing or reviewing code, apply CODING_STANDARDS.md.\n",
      );
      let failures = checkStandardsReviewRouting(root);
      assert.ok(
        failures.some((failure) =>
          failure.startsWith("AGENTS.md: route coding standards"),
        ),
      );
      assert.ok(
        failures.some((failure) =>
          failure.startsWith("AGENTS.md: replace implementation-wide"),
        ),
      );
      writeFileSync(
        join(root, "AGENTS.md"),
        "Before review, read CODING_STANDARDS.md.\nFor coding and review rules, read CODING_STANDARDS.md.\n",
      );
      assert.ok(
        checkStandardsReviewRouting(root).some((failure) =>
          failure.includes("replace implementation-wide"),
        ),
      );
      writeFileSync(
        join(root, "AGENTS.md"),
        "Before review, read CODING_STANDARDS.md.\nConsult a specific standard when an implementation question needs it.\n",
      );
      mkdirSync(join(root, "apps/web"), { recursive: true });
      writeFileSync(join(root, "apps/web/AGENTS.md"), "# Web\n");
      assert.deepEqual(checkStandardsReviewRouting(root), []);
      rmSync(join(root, "AGENTS.md"));
      failures = checkStandardsReviewRouting(root);
      assert.deepEqual(failures, [
        "AGENTS.md: standards review routing is missing",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts specification discovery and native manual-skill policy", () => {
    assert.deepEqual(checkHarnessRouting(repositoryRoot), []);
  });

  it("rejects a missing classifier worker reference without rejecting a valid reference", () => {
    const root = mkdtempSync(join(tmpdir(), "classification-routing-"));
    try {
      for (const name of readdirSync(repositoryRoot)) {
        if (name !== ".agents") {
          symlinkSync(join(repositoryRoot, name), join(root, name));
        }
      }
      const skills = join(root, ".agents/skills");
      mkdirSync(skills, { recursive: true });
      for (const name of readdirSync(join(repositoryRoot, ".agents/skills"))) {
        if (name !== "classify-change") {
          symlinkSync(
            join(repositoryRoot, ".agents/skills", name),
            join(skills, name),
          );
        }
      }
      const classifier = join(skills, "classify-change");
      mkdirSync(join(classifier, "references"), { recursive: true });
      writeFileSync(
        join(classifier, "SKILL.md"),
        "[Risk worker](references/risk.md)\n",
      );
      const failure =
        ".agents/skills/classify-change/SKILL.md: local pointer does not resolve: references/risk.md";
      assert.ok(checkHarnessRouting(root).includes(failure));

      writeFileSync(
        join(classifier, "references/risk.md"),
        "Risk assessment\n",
      );
      assert.deepEqual(checkHarnessRouting(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing specification skill and broken workflow pointers", () => {
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
          failure.includes("specification skill is missing"),
        ),
      );
      assert.ok(
        failures.some((failure) =>
          failure.startsWith("WORKFLOW.md: local pointer"),
        ),
      );
      assert.ok(
        failures.some((failure) =>
          failure.includes("route whole-specification work"),
        ),
      );
      assert.ok(
        failures.some((failure) => failure.includes("integration contract")),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects retired coordination, automatic stage selection and implicit manual invocation", () => {
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
        "A specification uses one integration branch and final PR\n[run](.agents/skills/implement-spec/SKILL.md)\n| Requested result | Route | Completion |\n",
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
          failure.includes("must not select a pipeline stage"),
        ),
      );
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
      writeFileSync(
        join(root, "WORKFLOW.md"),
        "A specification uses one integration branch and final PR\n[run](.agents/skills/implement-spec/SKILL.md)\n",
      );
      mkdirSync(join(root, "docs/agents"), { recursive: true });
      writeFileSync(
        join(root, "docs/agents/owner-corrections.md"),
        "Corrections\n",
      );
      for (const path of ["AGENTS.md", "WORKFLOW.md"]) {
        writeFileSync(
          join(root, path),
          readFileSync(join(root, path), "utf8") +
            "[Corrections](docs/agents/owner-corrections.md)\n",
        );
      }
      assert.deepEqual(checkHarnessRouting(root), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("workflow-owned harness configuration", () => {
  it("rejects ambiguous session modes, duplicate classification and legacy instruction authority", () => {
    const root = mkdtempSync(join(tmpdir(), "harness-config-"));
    try {
      writeFileSync(join(root, "AGENTS.md"), "Read WORKFLOW.md.\n");
      writeFileSync(
        join(root, "WORKFLOW.md"),
        "Session mode: worktree\nClassification: enabled; policy: docs/agents/change-risk.md\n",
      );
      mkdirSync(join(root, "docs/agents"), { recursive: true });
      writeFileSync(join(root, "docs/agents/change-risk.md"), "Policy\n");
      assert.deepEqual(checkHarnessConfiguration(root), []);
      const workflow = readFileSync(join(root, "WORKFLOW.md"), "utf8");
      for (const state of ["disabled", "deferred"]) {
        writeFileSync(
          join(root, "WORKFLOW.md"),
          `Session mode: main\nClassification: ${state}\n`,
        );
        assert.deepEqual(checkHarnessConfiguration(root), []);
      }
      for (const state of [
        "",
        "Classification: automatic\n",
        "Classification: enabled\n",
      ]) {
        writeFileSync(
          join(root, "WORKFLOW.md"),
          "Session mode: worktree\n" + state,
        );
        assert.ok(
          checkHarnessConfiguration(root).some((failure) =>
            failure.includes("exactly one Classification"),
          ),
        );
      }

      for (const mode of [
        "",
        "Session mode: automatic\n",
        "Session mode: main\nSession mode: worktree\n",
      ]) {
        writeFileSync(
          join(root, "WORKFLOW.md"),
          mode +
            "Classification: enabled; policy: docs/agents/change-risk.md\n",
        );
        assert.ok(
          checkHarnessConfiguration(root).some((failure) =>
            failure.includes("exactly one Session mode"),
          ),
        );
      }
      writeFileSync(
        join(root, "WORKFLOW.md"),
        workflow + "Classification: disabled\n",
      );
      assert.ok(
        checkHarnessConfiguration(root).some((failure) =>
          failure.includes("exactly one Classification"),
        ),
      );
      writeFileSync(join(root, "WORKFLOW.md"), workflow);
      writeFileSync(
        join(root, "AGENTS.md"),
        "Session mode: worktree\nClassification: enabled\n",
      );
      assert.ok(
        checkHarnessConfiguration(root).some((failure) =>
          failure.includes("WORKFLOW.md owns"),
        ),
      );
      writeFileSync(join(root, "AGENTS.md"), "Read WORKFLOW.md.\n");
      writeFileSync(join(root, "CLAUDE.md"), "@AGENTS.md\n");
      assert.ok(
        checkHarnessConfiguration(root).some((failure) =>
          failure.includes("CLAUDE.md"),
        ),
      );
      rmSync(join(root, "CLAUDE.md"));
      mkdirSync(join(root, "apps/web"), { recursive: true });
      writeFileSync(join(root, "apps/web/CLAUDE.md"), "@AGENTS.md\n");
      assert.ok(
        checkHarnessConfiguration(root).some((failure) =>
          failure.includes("apps/web/CLAUDE.md"),
        ),
      );
      rmSync(join(root, "apps/web/CLAUDE.md"));
      mkdirSync(join(root, "apps/web/test/fixtures"), { recursive: true });
      writeFileSync(
        join(root, "apps/web/test/fixtures/CLAUDE.md"),
        "Imported fixture\n",
      );
      mkdirSync(join(root, "docs/history"), { recursive: true });
      writeFileSync(
        join(root, "docs/history/CLAUDE.md"),
        "Historical instructions\n",
      );
      assert.deepEqual(checkHarnessConfiguration(root), []);
      rmSync(join(root, "docs/agents/change-risk.md"));
      assert.ok(
        checkHarnessConfiguration(root).some((failure) =>
          failure.includes("classification policy"),
        ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
