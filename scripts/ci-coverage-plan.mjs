// @ts-check
export const coverageIds = [
  "docs",
  "contracts",
  "static",
  "unit",
  "ui",
  "web-e2e",
  "integration",
  "integration-serial",
  "compose-development",
  "compose-production",
  "telegram",
  "fullstack",
];
const platformFull = [
  "contracts",
  "static",
  "unit",
  "ui",
  "web-e2e",
  "integration",
  "integration-serial",
  "compose-development",
  "compose-production",
  "fullstack",
];
/** @param {string} path */
export function classifyPath(path) {
  // Runtime/legal Markdown and assets are deliberately checked before prose.
  if (path.startsWith("apps/web/")) return "web";
  if (path.startsWith("apps/backend/")) return "backend";
  if (path.startsWith("apps/telegram/")) return "telegram";
  if (
    path.startsWith(".github/actions/") ||
    path.startsWith(".github/workflows/") ||
    path.startsWith("docs/contracts/") ||
    /^scripts\/ci-coverage-(plan|run)\.mjs$/u.test(path) ||
    path.startsWith("packages/") ||
    path.startsWith("docs/legal/") ||
    path.startsWith("docs/product/") ||
    path.startsWith("infra/") ||
    path.startsWith("tools/")
  )
    return "shared";
  if (
    /^(AGENTS|WORKFLOW|CODING_STANDARDS|REPOSITORIES|GLOSSARY)\.md$/u.test(
      path,
    ) ||
    path.startsWith("docs/agents/") ||
    path.startsWith(".agents/") ||
    path.startsWith(".claude/") ||
    path.startsWith(".github/") ||
    /^scripts\/ci-(coverage-plan|coverage-run|workflow-contract|gate-recovery)(\.test)?\.mjs$/u.test(
      path,
    )
  )
    return "instructions-tooling";
  if (
    /^docs\/(research|evidence|adr|runbooks|verification|specifications)\/.*\.md$/u.test(
      path,
    ) ||
    path === "README.md"
  )
    return "documentation";
  return "unknown";
}
/** @param {string[]} paths @param {string} event */
export function selectCoverage(paths, event) {
  if (!["pull_request", "merge_group"].includes(event))
    throw new Error("Unsupported changed-path event");
  const uniquePaths = [...new Set(paths)].sort();
  const categories = [...new Set(uniquePaths.map(classifyPath))].sort();
  // Empty/unknown change sets cannot silently eliminate application coverage.
  if (categories.length === 0) categories.push("unknown");
  const required = new Set(["docs"]);
  for (const category of categories) {
    if (category === "instructions-tooling") required.add("contracts");
    if (["web", "backend", "shared", "unknown"].includes(category)) {
      const selected =
        event === "merge_group" || ["shared", "unknown"].includes(category)
          ? platformFull
          : category === "web"
            ? ["static", "unit", "ui", "web-e2e"]
            : ["static", "unit", "integration", "integration-serial"];
      for (const id of selected) required.add(id);
    }
    if (["telegram", "shared", "unknown"].includes(category)) {
      for (const id of ["contracts", "static", "unit", "telegram"])
        required.add(id);
    }
  }
  return {
    event,
    paths: uniquePaths,
    categories,
    required: coverageIds.filter((id) => required.has(id)),
    excluded: coverageIds.filter((id) => !required.has(id)),
  };
}
/** @param {unknown} value @returns {string[]} */
export function parseCoverage(value) {
  if (
    !Array.isArray(value) ||
    !value.every((id) => typeof id === "string" && coverageIds.includes(id)) ||
    new Set(value).size !== value.length
  )
    throw new Error("Invalid coverage selection");
  return coverageIds.filter((id) => value.includes(id));
}
/** @param {unknown} value */
export function validatePlan(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    !("required" in value) ||
    !("excluded" in value)
  )
    throw new Error("Missing coverage plan");
  const required = parseCoverage(value.required);
  const excluded = parseCoverage(value.excluded);
  if (coverageIds.some((id) => required.includes(id) === excluded.includes(id)))
    throw new Error("Plan must explicitly partition all coverage");
  return { required, excluded };
}
/** @param {unknown} plan @param {unknown} results */
export function validateGate(plan, results) {
  const selected = validatePlan(plan);
  if (typeof results !== "object" || results === null)
    throw new Error("Missing job results");
  if (!("plan" in results) || !successfulResult(results.plan))
    throw new Error("Coverage planner did not succeed");
  for (const id of selected.required) {
    if (!(id in results) || !successfulResult(Reflect.get(results, id)))
      throw new Error(`Required check ${id} did not succeed`);
  }
  for (const id of selected.excluded) {
    if (!(id in results) || !skippedResult(Reflect.get(results, id)))
      throw new Error(`Excluded check ${id} must be explicitly skipped`);
  }
  return selected;
}

/** @param {unknown} value */
function successfulResult(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    value.result === "success"
  );
}
/** @param {unknown} value */
function skippedResult(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    value.result === "skipped"
  );
}
