// @ts-check
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { parseSync } from "oxc-parser";

/**
 * Служебный скрипт выполняет код прямо на верхнем уровне модуля, а функции объявляет ниже. Функция
 * поднимается, а `const`, `let` и `class` нет: если код верхнего уровня вызывает функцию, которая
 * читает модульное значение, объявленное ниже точки вызова, скрипт падает с `ReferenceError`
 * только при запуске. Так `pnpm smoke:fullstack` сломался после #765 (#774), а ни lint, ни
 * TypeScript этого не видят: внутри функции значение упомянуто ниже своего объявления.
 *
 * Проверка обходит каждый скрипт из `tsconfig.scripts.json`: для каждой инструкции верхнего уровня
 * находит модульные функции, достижимые из неё, и ищет в них модульные значения, объявленные ниже
 * этой инструкции. Вызов и передача модульной функции по имени считаются выполнением сразу, а тела
 * функций, вложенных в инструкцию верхнего уровня, отложенными: так `node:test` запускает `test()`
 * уже после загрузки модуля. Внутри достижимой функции учитывается всё её тело.
 */
const repositoryRoot = path.resolve(process.argv[2] ?? ".");

if (!statSync(repositoryRoot).isDirectory()) {
  throw new TypeError(
    `Module initialization order root is not a directory: ${repositoryRoot}`,
  );
}

/** @typedef {{ type: string; start: number; [key: string]: unknown }} AstNode */

/** @param {unknown} value @returns {value is AstNode} */
function isNode(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (/** @type {{ type?: unknown }} */ (value).type) === "string"
  );
}

/** @param {unknown} value @returns {AstNode[]} */
function childNodes(value) {
  if (Array.isArray(value)) return value.flatMap(childNodes);
  return isNode(value) ? [value] : [];
}

const nestedFunctionTypes = new Set([
  "FunctionExpression",
  "ArrowFunctionExpression",
  "FunctionDeclaration",
  "ClassDeclaration",
  "ClassExpression",
]);

/**
 * Names a subtree reads, without property names, object keys and labels. With `skipNested`, the
 * bodies of nested functions and classes are left out: code at the top level only defines them.
 * @param {AstNode} node
 * @param {Set<string>} names
 * @param {boolean} [skipNested]
 */
function collectReferences(node, names, skipNested = false) {
  if (skipNested && nestedFunctionTypes.has(node.type)) return;
  if (node.type === "Identifier") {
    names.add(/** @type {string} */ (node["name"]));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    if (key === "property" && node.type === "MemberExpression") {
      if (node["computed"] !== true) continue;
    }
    if (
      key === "key" &&
      ["Property", "MethodDefinition", "PropertyDefinition"].includes(
        node.type,
      ) &&
      node["computed"] !== true
    ) {
      continue;
    }
    if (key === "label") continue;
    for (const child of childNodes(value)) {
      collectReferences(child, names, skipNested);
    }
  }
}

/**
 * Names a binding pattern declares.
 * @param {unknown} pattern
 * @returns {string[]}
 */
function patternNames(pattern) {
  if (!isNode(pattern)) return [];
  switch (pattern.type) {
    case "Identifier":
      return [/** @type {string} */ (pattern["name"])];
    case "ObjectPattern":
      return childNodes(pattern["properties"]).flatMap((property) =>
        property.type === "RestElement"
          ? patternNames(property["argument"])
          : patternNames(property["value"]),
      );
    case "ArrayPattern":
      return childNodes(pattern["elements"]).flatMap(patternNames);
    case "RestElement":
      return patternNames(pattern["argument"]);
    case "AssignmentPattern":
      return patternNames(pattern["left"]);
    default:
      return [];
  }
}

/**
 * Names a function declares for itself: parameters, variables, inner functions and classes.
 * @param {AstNode} node
 * @param {Set<string>} names
 */
function collectLocalDeclarations(node, names) {
  if (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  ) {
    for (const parameter of childNodes(node["params"])) {
      for (const name of patternNames(parameter)) names.add(name);
    }
  }
  if (node.type === "VariableDeclarator") {
    for (const name of patternNames(node["id"])) names.add(name);
  }
  if (
    (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") &&
    isNode(node["id"])
  ) {
    names.add(/** @type {string} */ (node["id"]["name"]));
  }
  if (node.type === "CatchClause") {
    for (const name of patternNames(node["param"])) names.add(name);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "type" || key === "start" || key === "end") continue;
    for (const child of childNodes(value)) {
      collectLocalDeclarations(child, names);
    }
  }
}

/** @param {AstNode} statement */
function declarationOf(statement) {
  if (
    statement.type === "ExportNamedDeclaration" ||
    statement.type === "ExportDefaultDeclaration"
  ) {
    return isNode(statement["declaration"]) ? statement["declaration"] : null;
  }
  return statement;
}

/**
 * @param {string} source
 * @param {AstNode[]} body
 * @returns {string[]}
 */
function violationsIn(source, body) {
  /** @param {number} offset */
  const lineOf = (offset) => source.slice(0, offset).split("\n").length;

  /** Module `const`, `let` and `class` bindings and where they are declared. */
  /** @type {Map<string, number>} */
  const bindings = new Map();
  /** Module function declarations. */
  /** @type {Map<string, AstNode>} */
  const functions = new Map();
  for (const statement of body) {
    const declaration = declarationOf(statement);
    if (declaration === null) continue;
    if (
      declaration.type === "VariableDeclaration" &&
      declaration["kind"] !== "var"
    ) {
      for (const declarator of childNodes(declaration["declarations"])) {
        for (const name of patternNames(declarator["id"])) {
          bindings.set(name, declaration.start);
        }
      }
    } else if (
      declaration.type === "ClassDeclaration" &&
      isNode(declaration["id"])
    ) {
      bindings.set(
        /** @type {string} */ (declaration["id"]["name"]),
        declaration.start,
      );
    } else if (
      declaration.type === "FunctionDeclaration" &&
      isNode(declaration["id"])
    ) {
      functions.set(
        /** @type {string} */ (declaration["id"]["name"]),
        declaration,
      );
    }
  }

  /** Module names each function reads, minus the names it declares itself. */
  /** @type {Map<string, Set<string>>} */
  const readsOf = new Map();
  for (const [name, node] of functions) {
    const references = new Set();
    collectReferences(/** @type {AstNode} */ (node["body"]), references);
    for (const parameter of childNodes(node["params"])) {
      collectReferences(parameter, references);
    }
    const local = new Set();
    collectLocalDeclarations(node, local);
    local.delete(name);
    readsOf.set(
      name,
      new Set([...references].filter((reference) => !local.has(reference))),
    );
  }

  /** @type {string[]} */
  const violations = [];
  for (const statement of body) {
    const declaration = declarationOf(statement);
    if (
      statement.type === "ImportDeclaration" ||
      declaration?.type === "FunctionDeclaration"
    ) {
      continue;
    }
    const references = new Set();
    collectReferences(statement, references, true);
    const pending = [...references].filter((name) => functions.has(name));
    const reached = new Set(pending);
    while (pending.length > 0) {
      const current = /** @type {string} */ (pending.pop());
      for (const name of readsOf.get(current) ?? []) {
        if (functions.has(name) && !reached.has(name)) {
          reached.add(name);
          pending.push(name);
        }
      }
    }
    for (const functionName of reached) {
      for (const name of readsOf.get(functionName) ?? []) {
        const declaredAt = bindings.get(name);
        if (declaredAt !== undefined && declaredAt > statement.start) {
          violations.push(
            `line ${lineOf(statement.start)} runs ${functionName}, which reads ${name} declared later on line ${lineOf(declaredAt)}; declare ${name} before the code that runs`,
          );
        }
      }
    }
  }
  return [...new Set(violations)];
}

/**
 * Script files the scripts TypeScript project includes: `dir/**\/*.mjs` or `dir/*.mjs` patterns.
 * @returns {string[]}
 */
function scriptFiles() {
  const project = JSON.parse(
    readFileSync(path.join(repositoryRoot, "tsconfig.scripts.json"), "utf8"),
  );
  /** @type {string[]} */
  const include = project.include;
  /** @type {string[]} */
  const files = [];
  for (const pattern of include) {
    const recursive = pattern.endsWith("/**/*.mjs");
    const flat = !recursive && pattern.endsWith("/*.mjs");
    if (!recursive && !flat) {
      throw new TypeError(`Unsupported scripts pattern: ${pattern}`);
    }
    const directory = path.join(
      repositoryRoot,
      pattern.slice(0, recursive ? -"/**/*.mjs".length : -"/*.mjs".length),
    );
    if (statSync(directory, { throwIfNoEntry: false })?.isDirectory() !== true)
      continue;
    /** @param {string} current */
    const walk = (current) => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (
            recursive &&
            entry.name !== "node_modules" &&
            entry.name !== "fixtures"
          ) {
            walk(entryPath);
          }
        } else if (entry.name.endsWith(".mjs")) {
          files.push(entryPath);
        }
      }
    };
    walk(directory);
  }
  return [...new Set(files)];
}

const findings = scriptFiles().flatMap((file) => {
  const source = readFileSync(file, "utf8");
  const { errors, program } = parseSync(file, source);
  const [firstError] = errors;
  if (firstError !== undefined) {
    throw new SyntaxError(`Oxc could not parse ${file}: ${firstError.message}`);
  }
  return violationsIn(source, childNodes(program.body)).map(
    (message) => `${path.relative(repositoryRoot, file)}: ${message}`,
  );
});

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Module initialization order passed.\n");
}
