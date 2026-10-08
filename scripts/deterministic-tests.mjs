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

/** @param {Node} scope @param {string} binding */
function declares(scope, binding) {
  return nodes(scope["body"]).some((statement) => {
    if (
      statement.type === "ExportNamedDeclaration" &&
      node(statement["declaration"])
    )
      statement = statement["declaration"];
    if (statement.type === "VariableDeclaration")
      return nodes(statement["declarations"]).some((entry) =>
        bindingNames(entry["id"]).includes(binding),
      );
    if (statement.type === "ImportDeclaration")
      return nodes(statement["specifiers"]).some(
        (entry) => name(entry["local"]) === binding,
      );
    return (
      ["FunctionDeclaration", "ClassDeclaration"].includes(statement.type) &&
      name(statement["id"]) === binding
    );
  });
}

/**
 * Syntax checks, not proof of isolation or of a barrier's meaning. Aliased timer imports are
 * recognized; arbitrary wrappers and cross-module effects remain review responsibilities.
 * @param {string} file
 * @param {string} source
 * @param {boolean} [testSource] also enforce waits, data and unit boundaries
 * @returns {string[]}
 */
export function deterministicTestViolations(file, source, testSource = true) {
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
    testSource &&
    (/\/(?:unit|module)\//u.test(file) ||
      /^packages\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file));
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
    if (
      testSource &&
      nodes(statement["specifiers"]).some(
        (specifier) => name(specifier["imported"]) === "systemClock",
      )
    )
      report(statement, "wall-clock");
  }
  /** @type {{binding: string, scope: Node}[]} */
  const hoistedVariables = [];
  walk(program, (value, ancestors) => {
    if (value.type !== "VariableDeclaration" || value["kind"] !== "var") return;
    const owner = ancestors.findLast(
      (entry) => functionTypes.has(entry.type) || entry.type === "StaticBlock",
    );
    const scope =
      owner?.type === "StaticBlock"
        ? owner
        : owner !== undefined && node(owner["body"])
          ? owner["body"]
          : program;
    for (const declaration of nodes(value["declarations"]))
      for (const binding of bindingNames(declaration["id"]))
        hoistedVariables.push({ binding, scope });
  });
  /** @param {unknown} value @param {Node[]} ancestors */
  function globalDate(value, ancestors) {
    if (!node(value)) return false;
    const hidden = (/** @type {string} */ binding) =>
      hoistedVariables.some(
        (entry) => entry.binding === binding && ancestors.includes(entry.scope),
      ) ||
      shadowed(ancestors, binding) ||
      ancestors.some((scope) => {
        if (["Program", "BlockStatement", "StaticBlock"].includes(scope.type))
          return declares(scope, binding);
        if (scope.type === "CatchClause")
          return bindingNames(scope["param"]).includes(binding);
        if (["FunctionExpression", "ClassExpression"].includes(scope.type))
          return name(scope["id"]) === binding;
        const declaration =
          scope.type === "ForStatement"
            ? scope["init"]
            : ["ForInStatement", "ForOfStatement"].includes(scope.type)
              ? scope["left"]
              : null;
        return (
          node(declaration) &&
          declaration.type === "VariableDeclaration" &&
          nodes(declaration["declarations"]).some((entry) =>
            bindingNames(entry["id"]).includes(binding),
          )
        );
      });
    if (value.type === "Identifier")
      return name(value) === "Date" && !hidden("Date");
    return (
      value.type === "MemberExpression" &&
      name(value) === "Date" &&
      node(value["object"]) &&
      value["object"].type === "Identifier" &&
      ["globalThis", "window", "global"].includes(name(value["object"])) &&
      !hidden(name(value["object"]))
    );
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
  if (testSource && /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file))
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
    if (value.type === "UnaryExpression") return rootName(value["argument"]);
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
  /** @type {{call: Node, binding: string, scope: Node}[]} */
  const children = [];
  /** @type {{binding: string, scope: Node}[]} */
  const declarations = [];
  walk(program, (value, ancestors) => {
    if (value.type !== "VariableDeclarator") return;
    const scope =
      ancestors.findLast((entry) => entry.type === "BlockStatement") ?? program;
    for (const binding of bindingNames(value["id"]))
      declarations.push({ binding, scope });
  });
  const processCalls = new Set(["spawn", "fork"]);
  for (const statement of nodes(program.body)) {
    if (
      statement.type !== "ImportDeclaration" ||
      !node(statement["source"]) ||
      !/^(?:node:)?child_process$/u.test(String(statement["source"]["value"]))
    )
      continue;
    for (const specifier of nodes(statement["specifiers"]))
      if (["spawn", "fork"].includes(name(specifier["imported"])))
        processCalls.add(name(specifier["local"]));
  }
  walk(program, (value, ancestors) => {
    if (
      value.type !== "CallExpression" ||
      !processCalls.has(name(value["callee"]))
    )
      return;
    const declaration = ancestors.findLast((ancestor) =>
      ["VariableDeclarator", "AssignmentExpression"].includes(ancestor.type),
    );
    const binding =
      declaration === undefined
        ? ""
        : name(
            declaration[
              declaration.type === "VariableDeclarator" ? "id" : "left"
            ],
          );
    const owner = declarations.findLast(
      (entry) => entry.binding === binding && ancestors.includes(entry.scope),
    );
    children.push({
      call: value,
      binding,
      scope:
        owner?.scope ??
        ancestors.findLast((ancestor) => ancestor.type === "BlockStatement") ??
        program,
    });
  });
  const disposed = new Set();
  walk(program, (value, ancestors) => {
    if (value.type !== "CallExpression") return;
    const called = name(value["callee"]);
    const target =
      called === "kill" && node(value["callee"])
        ? rootName(value["callee"]["object"]) === "process" &&
          !children.some(
            (entry) =>
              entry.binding === "process" && ancestors.includes(entry.scope),
          )
          ? nodes(value["arguments"])[0]
          : value["callee"]["object"]
        : [
              "stopProcessGroup",
              "stopServerOnPort",
              "signalProcessGroup",
            ].includes(called)
          ? nodes(value["arguments"])[0]
          : null;
    const binding = rootName(target);
    const inCleanup = ancestors.some((ancestor, index) => {
      if (ancestor.type === "TryStatement" && node(ancestor["finalizer"])) {
        const finalizer = ancestors.indexOf(ancestor["finalizer"]);
        return (
          finalizer > index &&
          !ancestors
            .slice(finalizer + 1)
            .some((entry) => functionTypes.has(entry.type))
        );
      }
      return (
        ancestor.type === "CallExpression" &&
        ["after", "afterEach", "afterAll", "onTestFinished"].includes(
          name(ancestor["callee"]),
        ) &&
        ancestors
          .slice(index + 1)
          .filter((entry) => functionTypes.has(entry.type)).length === 1
      );
    });
    if (!inCleanup || binding === "") return;
    const child = children.findLast(
      (entry) =>
        entry.binding === binding &&
        ancestors.includes(entry.scope) &&
        !shadowed(ancestors.slice(ancestors.indexOf(entry.scope) + 1), binding),
    );
    if (child !== undefined) disposed.add(child.call);
  });
  for (const child of children)
    if (!disposed.has(child.call)) report(child.call, "process-cleanup");
  walk(program, (value, ancestors) => {
    if (
      testSource &&
      ["CallExpression", "NewExpression"].includes(value.type)
    ) {
      const callee = value["callee"];
      if (
        (globalDate(callee, ancestors) &&
          (value.type === "CallExpression" ||
            nodes(value["arguments"]).length === 0)) ||
        (value.type === "CallExpression" &&
          node(callee) &&
          name(callee) === "now" &&
          globalDate(callee["object"], ancestors))
      )
        report(value, "wall-clock");
    }
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
      if (testSource && timers.has(called)) report(value, "duration-wait");
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
