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
  collectReferenceDocuments,
  extractLocalMarkdownTargets,
} from "./check-agent-documentation.mjs";
import { checkMaterialsDocumentation } from "./check-materials-documentation.mjs";
import {
  checkDocumentReferences,
  extractCodePaths,
  extractMarkdownLinks,
  extractPnpmScripts,
  markdownAnchors,
} from "./documentation-references.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("agent documentation contract", () => {
  it("keeps current agent documentation references consistent", () => {
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

  it("covers agent documents, the workflow, README, REPOSITORIES and runbooks", () => {
    const { documents, pathDocuments } =
      collectReferenceDocuments(repositoryRoot);
    for (const path of [
      "AGENTS.md",
      "WORKFLOW.md",
      "README.md",
      "REPOSITORIES.md",
      "docs/agents/change-risk.md",
      "docs/runbooks/continuous-integration.md",
      "apps/web/AGENTS.md",
    ]) {
      assert.ok(documents.includes(path), path);
    }
    assert.ok(pathDocuments.has("WORKFLOW.md"));
    assert.ok(pathDocuments.has("docs/agents/change-risk.md"));
    assert.equal(pathDocuments.has("docs/runbooks/release.md"), false);
  });
});

describe("Materials documentation contract", () => {
  it("keeps the current Materials and Web data-boundary decisions marked", () => {
    assert.deepEqual(checkMaterialsDocumentation(repositoryRoot), []);
  });

  it("rejects a restored superseded term and a missing current marker", () => {
    const root = mkdtempSync(join(tmpdir(), "materials-docs-"));
    try {
      writeFileSync(join(root, "GLOSSARY.md"), "MaterialRevision\n");
      const failures = checkMaterialsDocumentation(root);
      assert.ok(
        failures.includes(
          "GLOSSARY.md: the active glossary must not restore the superseded MaterialRevision term",
        ),
      );
      assert.ok(
        failures.includes(
          "docs/adr/0009-one-mutable-material.md: required Materials document is missing",
        ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("document references", () => {
  it("extracts link fragments, including same-document anchors, outside code fences", () => {
    const markdown = [
      "[local](../GLOSSARY.md#material)",
      "[same](#completion)",
      "[external](https://example.com/a#b)",
      "[percent](b.md#50%)",
      "```md",
      "[fenced](missing.md#gone)",
      "```",
    ].join("\n");
    assert.deepEqual(extractMarkdownLinks(markdown), [
      { file: "../GLOSSARY.md", fragment: "material" },
      { file: "", fragment: "completion" },
      { file: "b.md", fragment: "50%" },
    ]);
  });

  it("derives GitHub heading anchors for punctuation, Cyrillic, code and repeats", () => {
    const anchors = markdownAnchors(
      [
        "---",
        "description: y",
        "---",
        "# Developer process",
        "## Branch, worktree and pull request",
        "## Поиск и навигация",
        "### `pnpm ci:wait` (PR)",
        "## Notes",
        "## Notes",
        "## _Italic_ and **bold** keep snake_case",
        "Setext title",
        "============",
        "- list item",
        "---",
        '<a id="custom-anchor"></a>',
        "```",
        "# not a heading",
        "```",
      ].join("\n"),
    );
    for (const anchor of [
      "developer-process",
      "branch-worktree-and-pull-request",
      "поиск-и-навигация",
      "pnpm-ciwait-pr",
      "notes",
      "notes-1",
      "custom-anchor",
      "italic-and-bold-keep-snake_case",
      "setext-title",
    ]) {
      assert.ok(anchors.has(anchor), anchor);
    }
    assert.equal(anchors.has("not-a-heading"), false);
    assert.equal(anchors.has("description-y"), false);
    assert.equal(anchors.has("--list-item"), false);
    assert.equal(anchors.has("list-item"), false);
  });

  it("extracts backticked repository paths and pnpm scripts", () => {
    const markdown = [
      "Read `scripts/ci-wait.py:12`, `apps/web/` and `ghcr.io/org/image`.",
      "Not paths: `pnpm docs:check`, `a b/c`, `<run-id>/x`, `*.md`.",
      "Run `pnpm --filter @inside/web test:e2e`, `pnpm install` or `pnpm deploy`.",
      "```bash",
      "pnpm run check:static && pnpm exec prettier --check .",
      "```",
    ].join("\n");
    assert.deepEqual(extractCodePaths(markdown), [
      "scripts/ci-wait.py",
      "apps/web/",
      "ghcr.io/org/image",
    ]);
    assert.deepEqual(extractPnpmScripts(markdown), [
      { filter: "", script: "docs:check" },
      { filter: "@inside/web", script: "test:e2e" },
      { filter: "", script: "check:static" },
    ]);
  });

  it("rejects missing anchors, paths and scripts while accepting valid ones", () => {
    const root = mkdtempSync(join(tmpdir(), "doc-references-"));
    try {
      mkdirSync(join(root, "docs/agents"), { recursive: true });
      mkdirSync(join(root, "apps/web"), { recursive: true });
      mkdirSync(join(root, "scripts"), { recursive: true });
      writeFileSync(join(root, "scripts/tool.mjs"), "");
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ scripts: { "docs:check": "node x" } }),
      );
      writeFileSync(
        join(root, "apps/web/package.json"),
        JSON.stringify({ name: "@inside/web", scripts: { dev: "next" } }),
      );
      writeFileSync(join(root, "docs/agents/target.md"), "## Merge queue\n");
      const valid = [
        "# Guide",
        "[queue](target.md#merge-queue) [self](#guide)",
        "Use `scripts/tool.mjs`, `scripts/tool` and `ghcr.io/org/image`.",
        "Run `pnpm docs:check` and `pnpm --filter @inside/web dev`.",
        "Generated `apps/web/storybook-static/index.html` is not committed.",
      ].join("\n");
      writeFileSync(join(root, "docs/agents/guide.md"), valid);
      const documents = ["docs/agents/guide.md"];
      assert.deepEqual(checkDocumentReferences(root, documents), []);

      writeFileSync(
        join(root, "docs/agents/guide.md"),
        [
          "# Guide",
          "[queue](target.md#merge) [self](#missing) [gone](gone.md)",
          "Use `scripts/missing.mjs`.",
          "Run `pnpm docs:missing` and `pnpm --filter @inside/web build`.",
          "Also `pnpm --filter @inside/missing dev` and `pnpm --filter ./apps/* dev`.",
        ].join("\n"),
      );
      assert.deepEqual(checkDocumentReferences(root, documents), [
        "docs/agents/guide.md: anchor does not resolve: target.md#merge",
        "docs/agents/guide.md: anchor does not resolve: #missing",
        "docs/agents/guide.md: local pointer does not resolve: gone.md",
        "docs/agents/guide.md: backticked path does not exist: scripts/missing.mjs",
        "docs/agents/guide.md: pnpm script does not exist: docs:missing",
        "docs/agents/guide.md: pnpm script does not exist: --filter @inside/web build",
        "docs/agents/guide.md: pnpm --filter names no workspace package: @inside/missing",
      ]);
      assert.ok(
        !checkDocumentReferences(root, documents, new Set()).some((failure) =>
          failure.includes("backticked path"),
        ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("harness routing contract", () => {
  it("requires the correction contract only from root routing", () => {
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
      const workflow = readFileSync(join(root, "WORKFLOW.md"), "utf8");
      writeFileSync(
        join(root, "WORKFLOW.md"),
        workflow.replaceAll("docs/agents/owner-corrections.md", "#removed"),
      );
      assert.deepEqual(checkHarnessRouting(root), []);
      writeFileSync(join(root, "WORKFLOW.md"), workflow);
      const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
      writeFileSync(
        join(root, "AGENTS.md"),
        agents.replaceAll("docs/agents/owner-corrections.md", "#removed"),
      );
      assert.deepEqual(checkHarnessRouting(root), [
        "AGENTS.md: keep explicit owner corrections reachable",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires review-stage standards routing from the root and rejects the former implementation gate", () => {
    const root = mkdtempSync(join(tmpdir(), "standards-routing-"));
    try {
      const paths = [
        "AGENTS.md",
        "apps/backend/AGENTS.md",
        "apps/web/AGENTS.md",
        "apps/telegram/AGENTS.md",
      ];
      writeFileSync(
        join(root, "AGENTS.md"),
        "Before review, read [standards](CODING_STANDARDS.md).\n",
      );
      for (const path of paths.slice(1)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), "Backend context.\n");
      }
      assert.deepEqual(checkStandardsReviewRouting(root), []);
      for (const path of paths) {
        const previous = readFileSync(join(root, path), "utf8");
        writeFileSync(
          join(root, path),
          "Before changing or reviewing code, apply CODING_STANDARDS.md.\n",
        );
        const failures = checkStandardsReviewRouting(root);
        assert.ok(
          failures.some((failure) =>
            failure.startsWith(`${path}: replace implementation-wide`),
          ),
        );
        assert.equal(
          failures.some((failure) =>
            failure.startsWith(`${path}: route coding standards`),
          ),
          path === "AGENTS.md",
        );
        writeFileSync(join(root, path), previous);
      }
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
      assert.deepEqual(checkStandardsReviewRouting(root), []);
      rmSync(join(root, "apps/web/AGENTS.md"));
      assert.deepEqual(checkStandardsReviewRouting(root), []);
      rmSync(join(root, "AGENTS.md"));
      assert.deepEqual(checkStandardsReviewRouting(root), [
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
      assert.ok(failures.some((failure) => failure.includes("owner-invoked")));
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
        "A specification uses one integration branch and final PR\n| Requested result | Route | Completion |\n",
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
        "A specification uses one integration branch and final PR\n",
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
