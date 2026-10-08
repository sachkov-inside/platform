// @ts-check
import { parseSync } from "oxc-parser";

/** @typedef {{type: string, start: number, end: number, [key: string]: unknown}} Node */
/** @param {unknown} value @returns {value is Node} */
function node(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  );
}
/** @param {unknown} value @returns {Node[]} */
function nodes(value) {
  return Array.isArray(value)
    ? value.flatMap(nodes)
    : node(value)
      ? [value]
      : [];
}
/** @param {Node} value @param {(value: Node, ancestors: Node[]) => void} visit @param {Node[]} [ancestors] */
function walk(value, visit, ancestors = []) {
  visit(value, ancestors);
  for (const child of Object.values(value).flatMap(nodes))
    walk(child, visit, [...ancestors, value]);
}
/** @param {unknown} value @returns {string} */
function name(value) {
  if (!node(value)) return "";
  if (value.type === "Identifier") return String(value["name"]);
  if (value.type === "MemberExpression")
    return value["computed"] === true
      ? String(node(value["property"]) ? value["property"]["value"] : "")
      : name(value["property"]);
  return "";
}

/**
 * Syntax checks, not proof of isolation or of a barrier's meaning. Aliased timer imports are
 * recognized; arbitrary wrappers and cross-module effects remain review responsibilities.
 * @param {string} file
 * @param {string} source
 * @returns {string[]}
 */
export function deterministicTestViolations(file, source) {
  const { program, errors, comments } = parseSync(file, source);
  if (!node(program)) throw new TypeError(`Missing AST for ${file}`);
  if (errors.length > 0)
    return [`${file}: parse-error: ${errors[0]?.message ?? "unknown"}`];
  const lines = source.split("\n");
  /** @type {string[]} */
  const findings = [];
  /** @type {Set<string>} */
  const timers = new Set(["setTimeout", "waitForTimeout"]);
  const unit =
    /\/(?:unit|module)\//u.test(file) ||
    /^packages\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file);
  /** @param {number} start @param {string} rule */
  function allowed(start, rule) {
    const line = source.slice(0, start).split("\n").length;
    const previous = lines[line - 2] ?? "";
    const reason = new RegExp(
      `^\\s*// deterministic-test-allow ${rule}: \\S.*\\S\\s*$`,
      "u",
    );
    return (
      reason.test(previous) &&
      comments.some(
        (comment) =>
          comment.type === "Line" &&
          source.slice(0, comment.start).split("\n").length === line - 1,
      )
    );
  }
  /** @param {Node} value @param {string} rule */
  function report(value, rule) {
    const line = source.slice(0, value.start).split("\n").length;
    if (!allowed(value.start, rule)) findings.push(`${file}:${line}: ${rule}`);
  }
  for (const statement of nodes(program.body)) {
    if (statement.type !== "ImportDeclaration") continue;
    const imported = node(statement["source"])
      ? String(statement["source"]["value"])
      : "";
    if (/^(?:node:)?timers(?:\/promises)?$/u.test(imported)) {
      for (const specifier of nodes(statement["specifiers"])) {
        if (name(specifier["imported"]) === "setTimeout")
          timers.add(name(specifier["local"]));
      }
    }
    if (
      unit &&
      /^(?:node:)?(?:child_process|https?|net|tls|dns)(?:\/|$)/u.test(imported)
    )
      report(statement, "unit-io");
  }
  const checksSharedData = /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file);
  const shared = new Set(
    nodes(program.body).flatMap((statement) =>
      checksSharedData && statement.type === "VariableDeclaration"
        ? nodes(statement["declarations"])
            .filter(
              (declaration) =>
                node(declaration["init"]) &&
                ["ObjectExpression", "ArrayExpression"].includes(
                  declaration["init"].type,
                ),
            )
            .map((declaration) => name(declaration["id"]))
            .filter((binding) => binding !== "")
        : [],
    ),
  );
  for (const statement of nodes(program.body)) {
    if (allowed(statement.start, "shared-mutation")) {
      for (const declaration of nodes(statement["declarations"]))
        shared.delete(name(declaration["id"]));
    }
  }
  /** @param {unknown} value @returns {string} */
  function rootName(value) {
    if (!node(value)) return "";
    return value.type === "MemberExpression"
      ? rootName(value["object"])
      : name(value);
  }
  // A syntactic reset in a per-test hook is allowed. Review checks its completeness.
  walk(program, (value) => {
    if (
      value.type !== "CallExpression" ||
      !["beforeEach", "afterEach"].includes(name(value["callee"]))
    )
      return;
    for (const argument of nodes(value["arguments"]))
      walk(argument, (reset) => {
        if (
          reset.type === "AssignmentExpression" &&
          node(reset["right"]) &&
          ((name(reset["left"]) === "length" &&
            reset["right"]["value"] === 0) ||
            ["ObjectExpression", "ArrayExpression", "NewExpression"].includes(
              reset["right"].type,
            ))
        )
          shared.delete(rootName(reset["left"]));
        if (
          reset.type === "CallExpression" &&
          name(reset["callee"]) === "splice" &&
          node(reset["callee"]) &&
          nodes(reset["arguments"])[0]?.["value"] === 0 &&
          nodes(reset["arguments"]).length === 1
        )
          shared.delete(rootName(reset["callee"]["object"]));
      });
  });
  walk(program, (value, ancestors) => {
    const target =
      value.type === "AssignmentExpression"
        ? value["left"]
        : value.type === "UpdateExpression"
          ? value["argument"]
          : value.type === "UnaryExpression" && value["operator"] === "delete"
            ? value["argument"]
            : value.type === "CallExpression" &&
                [
                  "push",
                  "pop",
                  "shift",
                  "unshift",
                  "splice",
                  "sort",
                  "reverse",
                  "fill",
                  "copyWithin",
                  "set",
                  "add",
                  "delete",
                  "clear",
                ].includes(name(value["callee"]))
              ? node(value["callee"])
                ? value["callee"]["object"]
                : null
              : null;
    const root = rootName(target);
    const shadowed = ancestors.some(
      (ancestor) =>
        nodes(ancestor["params"]).some(
          (parameter) => name(parameter) === root,
        ) ||
        (ancestor.type === "BlockStatement" &&
          nodes(ancestor["body"]).some(
            (statement) =>
              statement.type === "VariableDeclaration" &&
              nodes(statement["declarations"]).some(
                (declaration) => name(declaration["id"]) === root,
              ),
          )),
    );
    if (
      shared.has(root) &&
      !shadowed &&
      ancestors.some((ancestor) =>
        [
          "FunctionDeclaration",
          "FunctionExpression",
          "ArrowFunctionExpression",
        ].includes(ancestor.type),
      )
    )
      report(value, "shared-mutation");
    if (value.type === "CallExpression") {
      const called = name(value["callee"]);
      if (timers.has(called)) report(value, "duration-wait");
      if (unit && called === "fetch") report(value, "unit-io");
    }
    if (
      unit &&
      value.type === "ImportExpression" &&
      node(value["source"]) &&
      /^(?:node:)?(?:child_process|https?|net|tls|dns)(?:\/|$)/u.test(
        String(value["source"]["value"]),
      )
    )
      report(value, "unit-io");
  });
  return [...new Set(findings)];
}
