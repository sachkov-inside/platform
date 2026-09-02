import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(scriptPath), "..");
const ignoredDirectories = new Set([
  ".git",
  ".inside-harness",
  ".next",
  "coverage",
  "dist",
  "node_modules",
  "storybook-static",
]);

export function extractLocalMarkdownTargets(markdown) {
  const targets = [];
  const links = markdown.matchAll(/\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/gu);

  for (const [, rawTarget] of links) {
    const target = rawTarget.replace(/^<|>$/gu, "");
    if (
      target.startsWith("#") ||
      target.startsWith("/") ||
      /^[a-z][a-z\d+.-]*:/iu.test(target)
    ) {
      continue;
    }

    targets.push(decodeURIComponent(target.split("#", 1)[0].split("?", 1)[0]));
  }

  return targets.filter(Boolean);
}

function collectAgentDocumentation(repositoryRoot) {
  const files = new Set(["AGENTS.md", "CLAUDE.md", "CODING_STANDARDS.md"]);
  const roots = [resolve(repositoryRoot, "apps"), resolve(repositoryRoot, "docs/agents")];

  for (const root of roots) {
    walk(root, (path, name) => {
      if (
        name === "AGENTS.md" ||
        name === "CLAUDE.md" ||
        name === "CODING_STANDARDS.md" ||
        (path.startsWith(resolve(repositoryRoot, "docs/agents")) && name.endsWith(".md"))
      ) {
        files.add(relative(repositoryRoot, path));
      }
    });
  }

  return [...files].sort();
}

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

function read(repositoryRoot, path) {
  return readFileSync(resolve(repositoryRoot, path), "utf8");
}

function requireText(failures, path, content, expected, explanation) {
  if (!content.includes(expected)) {
    failures.push(`${path}: ${explanation}`);
  }
}

function rejectText(failures, path, content, forbidden, explanation) {
  if (content.includes(forbidden)) {
    failures.push(`${path}: ${explanation}`);
  }
}

export function checkDocumentation(repositoryRoot = defaultRepositoryRoot) {
  const failures = [];
  const agentFiles = collectAgentDocumentation(repositoryRoot);

  for (const path of agentFiles) {
    const absolutePath = resolve(repositoryRoot, path);
    if (!existsSync(absolutePath)) {
      failures.push(`${path}: required agent document is missing`);
      continue;
    }

    for (const target of extractLocalMarkdownTargets(readFileSync(absolutePath, "utf8"))) {
      const resolvedTarget = resolve(dirname(absolutePath), target);
      if (!existsSync(resolvedTarget)) {
        failures.push(`${path}: local pointer does not resolve: ${target}`);
      }
    }
  }

  const rootAgents = read(repositoryRoot, "AGENTS.md");
  const backendAgents = read(repositoryRoot, "apps/backend/AGENTS.md");
  const context = read(repositoryRoot, "CONTEXT.md");
  const materialsAdr = read(repositoryRoot, "docs/adr/0002-deep-materials-module.md");
  const generatedTransportAdr = read(
    repositoryRoot,
    "docs/adr/0007-generated-openapi-web-transport.md",
  );
  const mutableMaterialsAdr = read(repositoryRoot, "docs/adr/0009-one-mutable-material.md");
  const clientLibraryAdr = read(repositoryRoot, "docs/adr/0011-client-owned-library-catalog.md");
  const platformSpecification = read(repositoryRoot, "docs/specifications/platform-v1.md");
  const backendAudit = read(repositoryRoot, "docs/research/backend-architecture-audit.md");
  const engineeringResearch = read(
    repositoryRoot,
    "docs/research/platform-v1-engineering-contract.md",
  );
  const rootPackage = JSON.parse(read(repositoryRoot, "package.json"));

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
    "CONTEXT.md",
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
  for (const [path, content] of [
    ["docs/research/backend-architecture-audit.md", backendAudit],
    ["docs/research/platform-v1-engineering-contract.md", engineeringResearch],
  ]) {
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

  if (rootPackage.scripts["docs:check"] !== "node scripts/check-agent-documentation.mjs") {
    failures.push("package.json: docs:check must run the agent documentation contract");
  }
  if (!rootPackage.scripts.check.startsWith("pnpm docs:check &&")) {
    failures.push("package.json: the root check must start with pnpm docs:check");
  }

  return failures;
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
