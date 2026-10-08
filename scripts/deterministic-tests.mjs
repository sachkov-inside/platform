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

const functionTypes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
/** @param {unknown} pattern @returns {string[]} */
function bindingNames(pattern) {
  if (!node(pattern)) return [];
  if (pattern.type === "Identifier") return [name(pattern)];
  if (pattern.type === "ObjectPattern")
    return nodes(pattern["properties"]).flatMap((property) =>
      bindingNames(
        property.type === "RestElement"
          ? property["argument"]
          : property["value"],
      ),
    );
  if (pattern.type === "ArrayPattern")
    return nodes(pattern["elements"]).flatMap(bindingNames);
  if (pattern.type === "AssignmentPattern")
    return bindingNames(pattern["left"]);
  if (pattern.type === "RestElement") return bindingNames(pattern["argument"]);
  return [];
}
/** @param {Node[]} ancestors @param {string} binding */
function shadowed(ancestors, binding) {
  return ancestors.some(
    (ancestor) =>
      nodes(ancestor["params"]).flatMap(bindingNames).includes(binding) ||
      (ancestor.type === "BlockStatement" &&
        nodes(ancestor["body"]).some(
          (statement) =>
            statement.type === "VariableDeclaration" &&
            nodes(statement["declarations"])
              .flatMap((declaration) => bindingNames(declaration["id"]))
              .includes(binding),
        )),
  );
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
  const usedReasons = new Set();
  /** @param {number} start @param {string} rule */
  function allowed(start, rule) {
    const line = source.slice(0, start).split("\n").length;
    const previous = lines[line - 2] ?? "";
    const reason = new RegExp(
      `^\\s*// deterministic-test-allow ${rule}: \\S.*\\S\\s*$`,
      "u",
    );
    const comment = comments.find(
      (candidate) =>
        candidate.type === "Line" &&
        source.slice(0, candidate.start).split("\n").length === line - 1,
    );
    if (!reason.test(previous) || comment === undefined) return false;
    const key = `${rule}:${comment.start}`;
    if (usedReasons.has(key)) return false;
    usedReasons.add(key);
    return true;
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
  /** @type {Set<Node>} */
  const suites = new Set();
  /** @type {Set<Node>} */
  const setupCallbacks = new Set();
  walk(program, (value) => {
    if (
      value.type === "CallExpression" &&
      name(value["callee"]) === "beforeAll"
    ) {
      for (const argument of nodes(value["arguments"]))
        if (functionTypes.has(argument.type)) setupCallbacks.add(argument);
    }
    if (
      value.type === "CallExpression" &&
      name(value["callee"]) === "describe"
    ) {
      for (const argument of nodes(value["arguments"]))
        if (functionTypes.has(argument.type)) suites.add(argument);
    }
  });
  /** @typedef {{binding: string, scope: Node}} SharedBinding */
  /** @type {SharedBinding[]} */
  const shared = [];
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file))
    walk(program, (value, ancestors) => {
      if (
        value.type !== "VariableDeclaration" ||
        ancestors.some(
          (ancestor) =>
            functionTypes.has(ancestor.type) && !suites.has(ancestor),
        )
      )
        return;
      const scope =
        ancestors.findLast((ancestor) => ancestor.type === "BlockStatement") ??
        program;
      const exempt = allowed(value.start, "shared-mutation");
      if (exempt) return;
      for (const declaration of nodes(value["declarations"])) {
        if (
          node(declaration["init"]) &&
          ["ObjectExpression", "ArrayExpression"].includes(
            declaration["init"].type,
          ) &&
          name(declaration["id"]) !== ""
        )
          shared.push({ binding: name(declaration["id"]), scope });
      }
    });
  /** @param {string} binding @param {Node[]} ancestors @returns {SharedBinding | undefined} */
  function resolveShared(binding, ancestors) {
    const candidate = shared.findLast(
      (entry) => entry.binding === binding && ancestors.includes(entry.scope),
    );
    if (candidate === undefined) return undefined;
    return shadowed(
      ancestors.slice(ancestors.indexOf(candidate.scope) + 1),
      binding,
    )
      ? undefined
      : candidate;
  }
  /** @param {unknown} value @returns {string} */
  function rootName(value) {
    if (!node(value)) return "";
    return value.type === "MemberExpression"
      ? rootName(value["object"])
      : name(value);
  }
  /** A reset applies only in its registration scope, never in a sibling describe. */
  /** @type {Map<SharedBinding, (Node | null)[]>} */
  const resets = new Map();
  walk(program, (value, ancestors) => {
    if (
      value.type !== "CallExpression" ||
      !["beforeEach", "afterEach"].includes(name(value["callee"]))
    )
      return;
    const scope =
      ancestors.findLast((ancestor) => functionTypes.has(ancestor.type)) ??
      null;
    for (const argument of nodes(value["arguments"]))
      walk(argument, (reset, resetAncestors) => {
        // A nested helper declaration does not execute merely because the hook declares it.
        if (
          resetAncestors.filter((ancestor) => functionTypes.has(ancestor.type))
            .length !== 1
        )
          return;
        let target = null;
        if (
          reset.type === "AssignmentExpression" &&
          node(reset["right"]) &&
          ((name(reset["left"]) === "length" &&
            reset["right"]["value"] === 0) ||
            ["ObjectExpression", "ArrayExpression", "NewExpression"].includes(
              reset["right"].type,
            ))
        )
          target = reset["left"];
        if (
          reset.type === "CallExpression" &&
          name(reset["callee"]) === "splice" &&
          node(reset["callee"]) &&
          nodes(reset["arguments"])[0]?.["value"] === 0 &&
          nodes(reset["arguments"]).length === 1
        )
          target = reset["callee"]["object"];
        const binding = rootName(target);
        const sharedBinding = resolveShared(binding, [
          ...ancestors,
          value,
          ...resetAncestors,
        ]);
        if (target !== null && sharedBinding !== undefined)
          resets.set(sharedBinding, [
            ...(resets.get(sharedBinding) ?? []),
            scope,
          ]);
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
                ].includes(name(value["callee"]))
              ? node(value["callee"])
                ? value["callee"]["object"]
                : null
              : null;
    const root = rootName(target);
    const sharedBinding = resolveShared(root, ancestors);
    const resetInScope =
      sharedBinding !== undefined &&
      (resets.get(sharedBinding) ?? []).some(
        (scope) => scope === null || ancestors.includes(scope),
      );
    if (
      sharedBinding !== undefined &&
      !resetInScope &&
      !ancestors.some((ancestor) => setupCallbacks.has(ancestor)) &&
      ancestors.some((ancestor) => functionTypes.has(ancestor.type))
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
