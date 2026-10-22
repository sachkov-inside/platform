// @ts-check
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Current-decision markers for the Materials and Web data-boundary documents: superseded ADRs
 * stay marked as superseded, the current ADRs stay self-contained and active documents do not
 * restore the retired revision model.
 */

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = resolve(dirname(scriptPath), "..");

/** @typedef {{ path: string; text: string; explanation: string }} Marker */

/** @type {Marker[]} */
export const requiredMarkers = [
  {
    path: "apps/backend/AGENTS.md",
    text: "docs/adr/0009-one-mutable-material.md",
    explanation:
      "route Materials changes through the current mutable-model ADR",
  },
  {
    path: "docs/adr/0002-deep-materials-module.md",
    text: "status: superseded by ADR-0009",
    explanation:
      "make ADR 0009 the machine-readable current Materials decision",
  },
  {
    path: "docs/adr/0009-one-mutable-material.md",
    text: "This ADR supersedes ADR 0002 and restates all retained decisions",
    explanation: "keep the current Materials ADR self-contained",
  },
  {
    path: "docs/adr/0007-generated-openapi-web-transport.md",
    text: "status: superseded by ADR-0011",
    explanation:
      "make ADR 0011 the machine-readable current Web data-boundary decision",
  },
  {
    path: "docs/adr/0011-client-owned-library-catalog.md",
    text: "This ADR supersedes ADR 0007 and restates its retained transport",
    explanation: "keep the current Web data-boundary ADR self-contained",
  },
  {
    path: "docs/specifications/platform-v1.md",
    text: "один mutable Material",
    explanation: "retain the current one-mutable-Material contract",
  },
  ...[
    "docs/research/backend-architecture-audit.md",
    "docs/research/platform-v1-engineering-contract.md",
  ].flatMap((path) => [
    {
      path,
      text: "Статус: исторический snapshot",
      explanation:
        "mark revision-based research as historical rather than current guidance",
    },
    {
      path,
      text: "../adr/0009-one-mutable-material.md",
      explanation:
        "point historical Materials research to the current mutable-model ADR",
    },
  ]),
];

/** @type {Marker[]} */
export const forbiddenMarkers = [
  {
    path: "GLOSSARY.md",
    text: "MaterialRevision",
    explanation:
      "the active glossary must not restore the superseded MaterialRevision term",
  },
  {
    path: "docs/adr/0002-deep-materials-module.md",
    text: "MaterialRevisionId",
    explanation:
      "the retained ADR decision must not present revision identifiers as current",
  },
  ...[
    "MaterialsModule` ещё не потребляет",
    "Testcontainers PostgreSQL принят как future",
    "mapping checks приняты как future enforcement",
    "остаётся thin MCP adapter и ждёт",
  ].map((claim) => ({
    path: "docs/specifications/platform-v1.md",
    text: claim,
    explanation: `remove superseded current-state claim: ${claim}`,
  })),
];

/** @param {string} repositoryRoot */
export function checkMaterialsDocumentation(
  repositoryRoot = defaultRepositoryRoot,
) {
  /** @type {string[]} */
  const failures = [];
  /** @param {string} path */
  const read = (path) => {
    const absolute = resolve(repositoryRoot, path);
    return existsSync(absolute) ? readFileSync(absolute, "utf8") : undefined;
  };
  for (const { path, text, explanation } of requiredMarkers) {
    const content = read(path);
    if (content === undefined) {
      failures.push(`${path}: required Materials document is missing`);
    } else if (!content.includes(text)) {
      failures.push(`${path}: ${explanation}`);
    }
  }
  for (const { path, text, explanation } of forbiddenMarkers) {
    if (read(path)?.includes(text)) {
      failures.push(`${path}: ${explanation}`);
    }
  }
  return [...new Set(failures)];
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const failures = checkMaterialsDocumentation();
  if (failures.length > 0) {
    console.error(
      `Materials documentation contract failed (${failures.length}):`,
    );
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("Materials documentation contract passed.");
  }
}
