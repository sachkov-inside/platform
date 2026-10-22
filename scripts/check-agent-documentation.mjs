// @ts-check
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readPackageManifest } from "./package-manifest.mjs";

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

/** @param {string} markdown */
export function extractLocalMarkdownTargets(markdown) {
  /** @type {string[]} */
  const targets = [];
  const links = markdown.matchAll(
    /\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/gu,
  );

  for (const [, rawTarget = ""] of links) {
    const target = rawTarget.replace(/^<|>$/gu, "");
    if (
      target.startsWith("#") ||
      target.startsWith("/") ||
      /^[a-z][a-z\d+.-]*:/iu.test(target)
    ) {
      continue;
    }

    const [withoutFragment = ""] = target.split("#", 1);
    const [file = ""] = withoutFragment.split("?", 1);
    targets.push(decodeURIComponent(file));
  }

  return targets.filter(Boolean);
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

/**
 * @param {string[]} failures
 * @param {string} path
 * @param {string} content
 * @param {string} forbidden
 * @param {string} explanation
 */
function rejectText(failures, path, content, forbidden, explanation) {
  if (content.includes(forbidden)) {
    failures.push(`${path}: ${explanation}`);
  }
}

export const codingStandardsLineLimit = 200;
export const processContractLineLimit = 150;

/**
 * A document past its limit is a signal, not a failure (#848, #861): the rules of a coding standard
 * that a check can enforce should become checks, and a process contract should stay short.
 *
 * @param {string} repositoryRoot
 */
export function documentationWarnings(repositoryRoot = defaultRepositoryRoot) {
  /** @type {string[]} */
  const warnings = [];
  const standards = collectAgentDocumentation(repositoryRoot).filter((path) =>
    path.endsWith("CODING_STANDARDS.md"),
  );
  for (const path of standards) {
    if (!existsSync(resolve(repositoryRoot, path))) {
      continue;
    }

    const lines = lineCount(read(repositoryRoot, path));
    if (lines > codingStandardsLineLimit) {
      warnings.push(
        `${path}: ${lines} lines, more than ${codingStandardsLineLimit}; open a task to turn rules into checks`,
      );
    }
  }
  for (const path of ["AGENTS.md", "WORKFLOW.md"]) {
    if (!existsSync(resolve(repositoryRoot, path))) {
      continue;
    }

    const lines = lineCount(read(repositoryRoot, path));
    if (lines > processContractLineLimit) {
      warnings.push(
        `${path}: ${lines} lines, more than ${processContractLineLimit}; shorten the process contract`,
      );
    }
  }

  return warnings;
}

/** @param {string} content */
function lineCount(content) {
  if (content.length === 0) {
    return 0;
  }

  return content.replace(/\n$/u, "").split("\n").length;
}

/** @param {string} repositoryRoot */
export function checkHarnessConfiguration(
  repositoryRoot = defaultRepositoryRoot,
) {
  /** @type {string[]} */
  const failures = [];
  const workflowPath = resolve(repositoryRoot, "WORKFLOW.md");
  const workflow = existsSync(workflowPath)
    ? read(repositoryRoot, "WORKFLOW.md")
    : "";
  const modes = workflow.match(/^Session mode:.*$/gmu) ?? [];
  if (
    modes.length !== 1 ||
    !/^Session mode: (?:main|worktree)$/u.test(modes[0] ?? "")
  ) {
    failures.push(
      "WORKFLOW.md: require exactly one Session mode: main or worktree",
    );
  }
  const classifications = workflow.match(/^Classification:.*$/gmu) ?? [];
  const classification = classifications[0] ?? "";
  if (
    classifications.length !== 1 ||
    !/^Classification: (?:enabled; policy: [^\s;]+|disabled|deferred)$/u.test(
      classification,
    )
  ) {
    failures.push(
      "WORKFLOW.md: require exactly one Classification: enabled with policy, disabled or deferred",
    );
  } else if (classification.startsWith("Classification: enabled; policy: ")) {
    const policy = classification.slice(
      "Classification: enabled; policy: ".length,
    );
    if (
      policy.startsWith("/") ||
      policy.split(/[\\/]/u).includes("..") ||
      !existsSync(resolve(repositoryRoot, policy))
    ) {
      failures.push(
        "WORKFLOW.md: enabled classification policy must resolve within the repository",
      );
    }
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
      path.endsWith("AGENTS.md") &&
      existsSync(resolve(repositoryRoot, path)) &&
      /^(?:Session mode:|Classification:|Режим агентов:)/mu.test(
        read(repositoryRoot, path),
      )
    ) {
      failures.push(
        `${path}: WORKFLOW.md owns session mode and classification declarations`,
      );
    }
  }
  return failures;
}

/** @param {string} repositoryRoot */
export function checkHarnessRouting(repositoryRoot = defaultRepositoryRoot) {
  /** @type {string[]} */
  const failures = [];
  const entryPoint = ".agents/skills/implement-spec/SKILL.md";
  if (!existsSync(resolve(repositoryRoot, entryPoint))) {
    failures.push(`${entryPoint}: specification skill is missing`);
  }
  if (existsSync(resolve(repositoryRoot, ".agents/skills/orchestrate"))) {
    failures.push(
      ".agents/skills/orchestrate: superseded entry point remains active",
    );
  }
  const files = ["AGENTS.md", "WORKFLOW.md", ".agents/skills/PIPELINE.md"];
  for (const skill of [
    "implement-spec",
    "tdd",
    "classify-change",
    "code-review",
    "implement",
    "setup-matt-pocock-skills",
  ]) {
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
    if (path === "AGENTS.md" || path === "WORKFLOW.md") {
      requireText(
        failures,
        path,
        content,
        "docs/agents/owner-corrections.md",
        "keep explicit owner corrections reachable",
      );
    }
    rejectText(
      failures,
      path,
      content,
      "orchestrate/SKILL.md",
      "replace the superseded orchestrate pointer",
    );
    rejectText(
      failures,
      path,
      content,
      "/orchestrate",
      "replace the superseded orchestrate command",
    );
    for (const target of extractLocalMarkdownTargets(content)) {
      if (
        !existsSync(resolve(dirname(resolve(repositoryRoot, path)), target))
      ) {
        failures.push(`${path}: local pointer does not resolve: ${target}`);
      }
    }
    if (path === "WORKFLOW.md") {
      requireText(
        failures,
        path,
        content,
        "A specification uses one integration branch and final PR",
        "retain the coordinated specification integration contract",
      );
      rejectText(
        failures,
        path,
        content,
        "| Requested result | Route |",
        "completion requirements must not select a pipeline stage",
      );
      requireText(
        failures,
        path,
        content,
        entryPoint,
        "route whole-specification work to its skill",
      );
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
  const implementationWideLoading =
    /Before (?:changing|writing|implementing)[^\n]*reviewing[^\n]*(?:\n[^\n]*)?CODING_STANDARDS\.md|For coding and review rules/u;
  // The root file is the single standards pointer; nested files keep application context only.
  const root = "AGENTS.md";
  if (!existsSync(resolve(repositoryRoot, root))) {
    failures.push(`${root}: standards review routing is missing`);
  } else if (
    !/Before review,[^\n]*(?:\n[^\n]+)?CODING_STANDARDS\.md/u.test(
      read(repositoryRoot, root),
    )
  ) {
    failures.push(`${root}: route coding standards explicitly to review`);
  }
  for (const path of [
    root,
    "apps/backend/AGENTS.md",
    "apps/web/AGENTS.md",
    "apps/telegram/AGENTS.md",
  ]) {
    if (
      existsSync(resolve(repositoryRoot, path)) &&
      implementationWideLoading.test(read(repositoryRoot, path))
    ) {
      failures.push(
        `${path}: replace implementation-wide standards loading with review routing`,
      );
    }
  }
  return failures;
}

export function checkDocumentation(repositoryRoot = defaultRepositoryRoot) {
  /** @type {string[]} */
  const failures = [];
  failures.push(...checkHarnessRouting(repositoryRoot));
  failures.push(...checkHarnessConfiguration(repositoryRoot));
  failures.push(...checkStandardsReviewRouting(repositoryRoot));
  const agentFiles = collectAgentDocumentation(repositoryRoot);

  for (const path of agentFiles) {
    const absolutePath = resolve(repositoryRoot, path);
    if (!existsSync(absolutePath)) {
      failures.push(`${path}: required agent document is missing`);
      continue;
    }

    for (const target of extractLocalMarkdownTargets(
      readFileSync(absolutePath, "utf8"),
    )) {
      const resolvedTarget = resolve(dirname(absolutePath), target);
      if (!existsSync(resolvedTarget)) {
        failures.push(`${path}: local pointer does not resolve: ${target}`);
      }
    }
  }

  const rootAgents = read(repositoryRoot, "AGENTS.md");
  const backendAgents = read(repositoryRoot, "apps/backend/AGENTS.md");
  const context = read(repositoryRoot, "GLOSSARY.md");
  const materialsAdr = read(
    repositoryRoot,
    "docs/adr/0002-deep-materials-module.md",
  );
  const generatedTransportAdr = read(
    repositoryRoot,
    "docs/adr/0007-generated-openapi-web-transport.md",
  );
  const mutableMaterialsAdr = read(
    repositoryRoot,
    "docs/adr/0009-one-mutable-material.md",
  );
  const clientLibraryAdr = read(
    repositoryRoot,
    "docs/adr/0011-client-owned-library-catalog.md",
  );
  const platformSpecification = read(
    repositoryRoot,
    "docs/specifications/platform-v1.md",
  );
  const backendAudit = read(
    repositoryRoot,
    "docs/research/backend-architecture-audit.md",
  );
  const engineeringResearch = read(
    repositoryRoot,
    "docs/research/platform-v1-engineering-contract.md",
  );
  const rootPackage = readPackageManifest(
    resolve(repositoryRoot, "package.json"),
  );

  requireText(
    failures,
    "AGENTS.md",
    rootAgents,
    "docs/agents/documentation-maintenance.md",
    "route durable documentation changes through the maintenance contract",
  );
  requireText(
    failures,
    "apps/backend/AGENTS.md",
    backendAgents,
    "docs/adr/0009-one-mutable-material.md",
    "route Materials changes through the current mutable-model ADR",
  );
  rejectText(
    failures,
    "GLOSSARY.md",
    context,
    "MaterialRevision",
    "the active glossary must not restore the superseded MaterialRevision term",
  );
  requireText(
    failures,
    "docs/adr/0002-deep-materials-module.md",
    materialsAdr,
    "status: superseded by ADR-0009",
    "make ADR 0009 the machine-readable current Materials decision",
  );
  requireText(
    failures,
    "docs/adr/0009-one-mutable-material.md",
    mutableMaterialsAdr,
    "This ADR supersedes ADR 0002 and restates all retained decisions",
    "keep the current Materials ADR self-contained",
  );
  requireText(
    failures,
    "docs/adr/0007-generated-openapi-web-transport.md",
    generatedTransportAdr,
    "status: superseded by ADR-0011",
    "make ADR 0011 the machine-readable current Web data-boundary decision",
  );
  requireText(
    failures,
    "docs/adr/0011-client-owned-library-catalog.md",
    clientLibraryAdr,
    "This ADR supersedes ADR 0007 and restates its retained transport",
    "keep the current Web data-boundary ADR self-contained",
  );
  rejectText(
    failures,
    "docs/adr/0002-deep-materials-module.md",
    materialsAdr,
    "MaterialRevisionId",
    "the retained ADR decision must not present revision identifiers as current",
  );
  for (const staleClaim of [
    "MaterialsModule` ещё не потребляет",
    "Testcontainers PostgreSQL принят как future",
    "mapping checks приняты как future enforcement",
    "остаётся thin MCP adapter и ждёт",
  ]) {
    rejectText(
      failures,
      "docs/specifications/platform-v1.md",
      platformSpecification,
      staleClaim,
      `remove superseded current-state claim: ${staleClaim}`,
    );
  }
  requireText(
    failures,
    "docs/specifications/platform-v1.md",
    platformSpecification,
    "один mutable Material",
    "retain the current one-mutable-Material contract",
  );
  for (const [path, content] of /** @type {const} */ ([
    ["docs/research/backend-architecture-audit.md", backendAudit],
    ["docs/research/platform-v1-engineering-contract.md", engineeringResearch],
  ])) {
    requireText(
      failures,
      path,
      content,
      "Статус: исторический snapshot",
      "mark revision-based research as historical rather than current guidance",
    );
    requireText(
      failures,
      path,
      content,
      "../adr/0009-one-mutable-material.md",
      "point historical Materials research to the current mutable-model ADR",
    );
  }

  if (
    rootPackage.scripts["docs:check"] !==
    "node scripts/check-agent-documentation.mjs"
  ) {
    failures.push(
      "package.json: docs:check must run the agent documentation contract",
    );
  }
  if (
    !(
      rootPackage.scripts["check"]?.startsWith("pnpm check:static &&") ||
      rootPackage.scripts["check"]?.startsWith(
        "bash scripts/heavy-check.sh bash -c 'pnpm check:static &&",
      )
    ) ||
    !rootPackage.scripts["check:static"]?.startsWith("pnpm docs:check &&")
  ) {
    failures.push(
      "package.json: the root check must start with pnpm check:static, which starts with pnpm docs:check",
    );
  }

  return failures;
}

function run() {
  for (const warning of documentationWarnings()) {
    console.warn(`Warning: ${warning}`);
  }

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
