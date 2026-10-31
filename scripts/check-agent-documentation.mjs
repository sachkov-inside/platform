// @ts-check
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkDocumentReferences,
  extractMarkdownLinks,
} from "./documentation-references.mjs";
import { readPackageScripts } from "./package-scripts.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(scriptPath), "..");
const ignoredDirectories = new Set([
  ".git",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "storybook-static",
]);

/**
 * Local files that Markdown links point to, without fragments; same-document anchors excluded.
 *
 * @param {string} markdown
 */
export function extractLocalMarkdownTargets(markdown) {
  return extractMarkdownLinks(markdown)
    .map(({ file }) => file)
    .filter(Boolean);
}

/** @param {string} repositoryRoot */
function collectAgentDocumentation(repositoryRoot) {
  const files = new Set(["AGENTS.md", "CODING_STANDARDS.md"]);
  const roots = [
    resolve(repositoryRoot, "apps"),
    resolve(repositoryRoot, "docs/agents"),
    resolve(repositoryRoot, "scripts"),
  ];

  for (const root of roots) {
    walk(root, (path, name) => {
      if (
        name === "AGENTS.md" ||
        name === "CLAUDE.md" ||
        name === "CODING_STANDARDS.md" ||
        (path.startsWith(resolve(repositoryRoot, "docs/agents")) &&
          name.endsWith(".md"))
      ) {
        files.add(relative(repositoryRoot, path));
      }
    });
  }

  return [...files].sort();
}

/**
 * @param {string} root
 * @param {(path: string, name: string) => void} visit
 */
function walk(root, visit) {
  if (!existsSync(root)) {
    return;
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
      walk(resolve(root, entry.name), visit);
    } else if (entry.isFile()) {
      visit(resolve(root, entry.name), entry.name);
    }
  }
}

/**
 * @param {string} repositoryRoot
 * @param {string} path
 */
function read(repositoryRoot, path) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

/**
 * @param {string[]} failures
 * @param {string} path
 * @param {string} content
 * @param {string} expected
 * @param {string} explanation
 */
function requireText(failures, path, content, expected, explanation) {
  if (!content.includes(expected)) {
    failures.push(`${path}: ${explanation}`);
  }
}

/** @param {string} repositoryRoot */
export function checkHarnessConfiguration(
  repositoryRoot = defaultRepositoryRoot,
) {
  /** @type {string[]} */
  const failures = [];
  const agents = existsSync(resolve(repositoryRoot, "AGENTS.md"))
    ? read(repositoryRoot, "AGENTS.md")
    : "";
  const modes = agents.match(/^Session mode:.*$/gmu) ?? [];
  if (
    modes.length !== 1 ||
    !/^Session mode: (?:main|worktree)$/u.test(modes[0] ?? "")
  ) {
    failures.push(
      "AGENTS.md: require exactly one Session mode: main or worktree",
    );
  }
  // Decision 199 retired WORKFLOW.md; the root AGENTS.md and docs/agents/ replace it.
  if (existsSync(resolve(repositoryRoot, "WORKFLOW.md"))) {
    failures.push(
      "WORKFLOW.md: retired; move its rules to AGENTS.md or docs/agents/",
    );
  }
  const documents = collectAgentDocumentation(repositoryRoot);
  if (existsSync(resolve(repositoryRoot, "CLAUDE.md")))
    documents.push("CLAUDE.md");
  for (const path of documents) {
    // Historical and imported fixtures retain their original filenames and contents.
    if (
      path
        .split("/")
        .some((part) =>
          ["history", "fixtures", "upstream", "vendor"].includes(part),
        )
    )
      continue;
    if (path.endsWith("CLAUDE.md")) {
      failures.push(
        `${path}: owner-maintained instructions belong in AGENTS.md`,
      );
    }
    if (
      path !== "AGENTS.md" &&
      path.endsWith("AGENTS.md") &&
      existsSync(resolve(repositoryRoot, path)) &&
      /^(?:Session mode:|Classification:|Режим агентов:)/mu.test(
        read(repositoryRoot, path),
      )
    ) {
      failures.push(`${path}: the root AGENTS.md owns the session mode`);
    }
  }
  return failures;
}

/** Skills of the implementation route; `sync-pipeline` installs them together. */
export const implementationRoute = [
  "implement",
  "implement-spec",
  "tdd",
  "code-review",
  "pr",
  "ship",
];

/** @param {string} repositoryRoot */
export function checkHarnessRouting(repositoryRoot = defaultRepositoryRoot) {
  /** @type {string[]} */
  const failures = [];
  for (const skill of implementationRoute) {
    if (
      !existsSync(resolve(repositoryRoot, ".agents/skills", skill, "SKILL.md"))
    ) {
      failures.push(
        `.agents/skills/${skill}/SKILL.md: implementation route skill is missing`,
      );
    }
  }
  for (const retired of ["orchestrate", "classify-change"]) {
    if (existsSync(resolve(repositoryRoot, ".agents/skills", retired))) {
      failures.push(
        `.agents/skills/${retired}: superseded skill remains active`,
      );
    }
  }
  const files = ["AGENTS.md", ".agents/skills/PIPELINE.md"];
  for (const skill of [...implementationRoute, "setup-matt-pocock-skills"]) {
    walk(resolve(repositoryRoot, ".agents/skills", skill), (path, name) => {
      if (name.endsWith(".md")) files.push(relative(repositoryRoot, path));
    });
  }
  for (const path of new Set(files)) {
    if (!existsSync(resolve(repositoryRoot, path))) {
      failures.push(`${path}: required routing document is missing`);
      continue;
    }
    const content = read(repositoryRoot, path);
    if (path === "AGENTS.md") {
      requireText(
        failures,
        path,
        content,
        "docs/agents/owner-corrections.md",
        "keep explicit owner corrections reachable",
      );
    }
    for (const target of extractLocalMarkdownTargets(content)) {
      if (
        !existsSync(resolve(dirname(resolve(repositoryRoot, path)), target))
      ) {
        failures.push(`${path}: local pointer does not resolve: ${target}`);
      }
    }
  }
  walk(resolve(repositoryRoot, ".agents/skills"), (path, name) => {
    if (
      name !== "SKILL.md" ||
      !readFileSync(path, "utf8").includes("disable-model-invocation: true")
    ) {
      return;
    }
    const adapter = resolve(dirname(path), "agents/openai.yaml");
    if (
      !existsSync(adapter) ||
      !readFileSync(adapter, "utf8").includes(
        "policy:\n  allow_implicit_invocation: false",
      )
    ) {
      failures.push(
        `${relative(repositoryRoot, adapter)}: manual skill requires native implicit-invocation policy`,
      );
    }
  });
  return failures;
}

/** @param {string} repositoryRoot */
export function checkStandardsReviewRouting(
  repositoryRoot = defaultRepositoryRoot,
) {
  /** @type {string[]} */
  const failures = [];
  // The root routes every reviewer to the standards; nested files need not repeat it.
  if (!existsSync(resolve(repositoryRoot, "AGENTS.md"))) {
    failures.push("AGENTS.md: standards review routing is missing");
  } else if (
    !/Before review,[^\n]*(?:\n[^\n]+)?CODING_STANDARDS\.md/u.test(
      read(repositoryRoot, "AGENTS.md"),
    )
  ) {
    failures.push("AGENTS.md: route coding standards explicitly to review");
  }
  // No file may restore the former implementation-wide loading of the standards.
  for (const path of [
    "AGENTS.md",
    "apps/backend/AGENTS.md",
    "apps/web/AGENTS.md",
    "apps/telegram/AGENTS.md",
  ]) {
    if (
      existsSync(resolve(repositoryRoot, path)) &&
      /Before (?:changing|writing|implementing)[^\n]*reviewing[^\n]*(?:\n[^\n]*)?CODING_STANDARDS\.md|For coding and review rules/u.test(
        read(repositoryRoot, path),
      )
    ) {
      failures.push(
        `${path}: replace implementation-wide standards loading with review routing`,
      );
    }
  }
  return failures;
}

/**
 * Documents whose links, anchors and `pnpm` scripts must resolve, and the subset whose
 * backticked repository paths must also exist.
 *
 * @param {string} repositoryRoot
 */
export function collectReferenceDocuments(repositoryRoot) {
  const agentDocuments = collectAgentDocumentation(repositoryRoot);
  const documents = new Set([
    ...agentDocuments,
    "README.md",
    "REPOSITORIES.md",
  ]);
  for (const directory of ["runbooks", "product", "specifications", "adr"]) {
    walk(resolve(repositoryRoot, "docs", directory), (path, name) => {
      if (name.endsWith(".md")) documents.add(relative(repositoryRoot, path));
    });
  }
  return {
    documents: [...documents].sort(),
    pathDocuments: new Set(agentDocuments),
  };
}

export const docsCheckCommand =
  "node scripts/check-agent-documentation.mjs && node scripts/check-materials-documentation.mjs && node scripts/check-new-em-dashes.mjs";

export function checkDocumentation(repositoryRoot = defaultRepositoryRoot) {
  /** @type {string[]} */
  const failures = [];
  failures.push(...checkHarnessRouting(repositoryRoot));
  failures.push(...checkHarnessConfiguration(repositoryRoot));
  failures.push(...checkStandardsReviewRouting(repositoryRoot));
  const { documents, pathDocuments } =
    collectReferenceDocuments(repositoryRoot);
  failures.push(
    ...checkDocumentReferences(repositoryRoot, documents, pathDocuments),
  );

  requireText(
    failures,
    "AGENTS.md",
    read(repositoryRoot, "AGENTS.md"),
    "docs/agents/documentation-maintenance.md",
    "route durable documentation changes through the maintenance contract",
  );

  const rootScripts = readPackageScripts(
    resolve(repositoryRoot, "package.json"),
  ).scripts;
  if (rootScripts["docs:check"] !== docsCheckCommand) {
    failures.push(
      "package.json: docs:check must run the agent documentation, Materials documentation and new em dash checks",
    );
  }
  if (
    !(
      rootScripts["check"]?.startsWith("pnpm check:static &&") ||
      rootScripts["check"]?.startsWith(
        "bash scripts/heavy-check.sh bash -c 'pnpm check:static &&",
      )
    ) ||
    !rootScripts["check:static"]?.startsWith("pnpm docs:check &&")
  ) {
    failures.push(
      "package.json: the root check must start with pnpm check:static, which starts with pnpm docs:check",
    );
  }

  return [...new Set(failures)];
}

function run() {
  const failures = checkDocumentation();
  if (failures.length > 0) {
    console.error(`Documentation contract failed (${failures.length}):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Documentation contract passed.");
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  run();
}
