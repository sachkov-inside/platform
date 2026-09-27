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
 * TypeScript этого не видят: внутри функции значение упомянуто ниже своего объявления. Прямое
 * чтение до объявления на верхнем уровне уже ловит TypeScript через `// @ts-check`.
 *
 * Проверка обходит каждый скрипт из `tsconfig.scripts.json`. Модульные функции — это объявления
 * `function`, функции и стрелки в модульном `const` или `let` и объявления `class`; объявление класса
 * выполняет его `extends`, вычисляемые ключи, статические поля и блоки. Выражение класса в `const`
 * проверка не разбирает. Для каждой инструкции верхнего уровня
 * проверка находит функции, которые инструкция вызывает или передаёт по имени, и всё, что достижимо
 * из них, и ищет в их телах модульные значения, объявленные не раньше этой инструкции. Тела функций,
 * вложенных прямо в инструкцию верхнего уровня, считаются отложенными: так `node:test` запускает
 * `test()` уже после загрузки модуля. Поэтому колбэк, который инструкция выполняет сразу (например,
 * в `.map()`), проверка не видит. Передача функции по имени считается вызовом, даже если это
 * обработчик на потом.
 */
const repositoryRoot = path.resolve(process.argv[2] ?? ".");
/** Project file relative to the root; a fixture passes its own to stay out of the tsconfig set. */
const projectFile = process.argv[3] ?? "tsconfig.scripts.json";

if (!statSync(repositoryRoot).isDirectory()) {
  throw new TypeError(
    `Module initialization order root is not a directory: ${repositoryRoot}`,
  );
}

/** @typedef {{ type: string; start: number; [key: string]: unknown }} AstNode */

const functionTypes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);
/** Nodes whose bodies do not run where they are written. */
const deferredBodyTypes = new Set([
  ...functionTypes,
  "ClassDeclaration",
  "ClassExpression",
]);

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

/**
 * The name of an identifier, or of the `id` of a function or class declaration.
 * @param {unknown} node
 * @returns {string | null}
 */
function declaredName(node) {
  if (!isNode(node)) return null;
  if (node.type === "Identifier") return String(node["name"]);
  return isNode(node["id"]) ? declaredName(node["id"]) : null;
}

/**
 * Child nodes by field. The walk is manual rather than an oxc `Visitor` because reading a name
 * depends on the parent field (a property name is not a read) and nested bodies can be skipped.
 * @param {AstNode} node
 * @returns {[string, AstNode][]}
 */
function fields(node) {
  return Object.entries(node).flatMap(([key, value]) =>
    key === "type" || key === "start" || key === "end"
      ? []
      : childNodes(value).map(
          (child) => /** @type {[string, AstNode]} */ ([key, child]),
        ),
  );
}

/**
 * Names a subtree reads, without declared names, property names, object keys and labels. With
 * `skipDeferred`, the bodies of nested functions and classes are left out.
 * @param {AstNode} node
 * @param {Set<string>} names
 * @param {boolean} [skipDeferred]
 */
function collectReferences(node, names, skipDeferred = false) {
  if (skipDeferred && deferredBodyTypes.has(node.type)) return;
  if (node.type === "Identifier") {
    names.add(String(node["name"]));
    return;
  }
  for (const [key, child] of fields(node)) {
    if (key === "label") continue;
    if (key === "id" && node.type === "VariableDeclarator") continue;
    if (
      key === "property" &&
      node.type === "MemberExpression" &&
      node["computed"] !== true
    ) {
      continue;
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
    collectReferences(child, names, skipDeferred);
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
      return [String(pattern["name"])];
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
 * Names a function declares in its own scope: parameters and the declarations directly in its body.
 * A name declared only in a nested block or callback still counts as a read of the module value,
 * which can report a shadowed name but never hides a real read.
 * @param {AstNode} node
 * @returns {Set<string>}
 */
function ownDeclarations(node) {
  const names = new Set(childNodes(node["params"]).flatMap(patternNames));
  const body = node["body"];
  const statements =
    isNode(body) && body.type === "BlockStatement"
      ? childNodes(body["body"])
      : [];
  for (const statement of statements) {
    if (statement.type === "VariableDeclaration") {
      for (const declarator of childNodes(statement["declarations"])) {
        for (const name of patternNames(declarator["id"])) names.add(name);
      }
    } else if (
      statement.type === "FunctionDeclaration" ||
      statement.type === "ClassDeclaration"
    ) {
      const name = declaredName(statement);
      if (name !== null) names.add(name);
    }
  }
  return names;
}

/**
 * Names a class declaration reads while it is declared: its `extends`, computed keys, static
 * fields and static blocks. Instance members and methods run later.
 * @param {AstNode} node
 * @returns {Set<string>}
 */
function classInitializationReferences(node) {
  const names = new Set();
  if (isNode(node["superClass"])) {
    collectReferences(node["superClass"], names, true);
  }
  const body = node["body"];
  for (const member of isNode(body) ? childNodes(body["body"]) : []) {
    if (member["computed"] === true && isNode(member["key"])) {
      collectReferences(member["key"], names, true);
    }
    if (member.type === "StaticBlock") {
      for (const statement of childNodes(member["body"])) {
        collectReferences(statement, names, true);
      }
    } else if (
      member.type === "PropertyDefinition" &&
      member["static"] === true &&
      isNode(member["value"])
    ) {
      collectReferences(member["value"], names, true);
    }
  }
  return names;
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

  /** Module `const`, `let` and `class` bindings and the statement that declares each. */
  /** @type {Map<string, number>} */
  const bindings = new Map();
  /** Module functions: `function` declarations, functions in a module `const` or `let`, classes. */
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
        const name = declaredName(declarator["id"]);
        const init = declarator["init"];
        if (name !== null && isNode(init) && functionTypes.has(init.type)) {
          functions.set(name, init);
        }
      }
    } else if (declaration.type === "ClassDeclaration") {
      const name = declaredName(declaration);
      if (name !== null) {
        bindings.set(name, declaration.start);
        functions.set(name, declaration);
      }
    } else if (declaration.type === "FunctionDeclaration") {
      const name = declaredName(declaration);
      if (name !== null) functions.set(name, declaration);
    }
  }

  /** Module names each function reads, minus the names it declares itself. */
  /** @type {Map<string, Set<string>>} */
  const readsOf = new Map();
  for (const [name, node] of functions) {
    const references = new Set();
    for (const [key, child] of fields(node)) {
      if (key !== "id") collectReferences(child, references);
    }
    const own = functionTypes.has(node.type)
      ? ownDeclarations(node)
      : new Set();
    readsOf.set(
      name,
      new Set([...references].filter((reference) => !own.has(reference))),
    );
  }

  /** @type {string[]} */
  const violations = [];
  for (const statement of body) {
    const declaration = declarationOf(statement);
    // Imports, `export { name }` and `export default name` only name bindings; they run nothing.
    if (
      statement.type === "ImportDeclaration" ||
      declaration === null ||
      declaration.type === "Identifier" ||
      declaration.type === "FunctionDeclaration"
    ) {
      continue;
    }
    /** @type {Set<string>} */
    let references;
    if (declaration.type === "ClassDeclaration") {
      references = classInitializationReferences(declaration);
    } else {
      references = new Set();
      collectReferences(statement, references, true);
    }
    const pending = [...references].filter((name) => functions.has(name));
    const reached = new Set(pending);
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) break;
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
        if (declaredAt !== undefined && declaredAt >= statement.start) {
          violations.push(
            `line ${lineOf(statement.start)} runs ${functionName}, which reads ${name} declared on line ${lineOf(declaredAt)}; declare ${name} before the code that runs`,
          );
        }
      }
    }
  }
  return [...new Set(violations)];
}

/**
 * Script files of the scripts TypeScript project: its `include` patterns `dir/**\/*.mjs` or
 * `dir/*.mjs`, without directories its `exclude` patterns `**\/name/**` name.
 * @returns {string[]}
 */
function scriptFiles() {
  const project = JSON.parse(
    readFileSync(path.join(repositoryRoot, projectFile), "utf8"),
  );
  /** @type {string[]} */
  const include = project.include ?? [];
  /** @type {string[]} */
  const exclude = project.exclude ?? [];
  const excludedDirectories = new Set(
    exclude.map((pattern) => {
      const match = /^\*\*\/([^/*]+)\/\*\*$/u.exec(pattern);
      if (match?.[1] === undefined) {
        throw new TypeError(`Unsupported scripts exclude pattern: ${pattern}`);
      }
      return match[1];
    }),
  );
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} directory
   * @param {boolean} recursive
   */
  const collect = (directory, recursive) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !excludedDirectories.has(entry.name)) {
          collect(entryPath, true);
        }
      } else if (entry.name.endsWith(".mjs")) {
        files.push(entryPath);
      }
    }
  };
  for (const pattern of include) {
    const recursive = pattern.endsWith("/**/*.mjs");
    if (!recursive && !pattern.endsWith("/*.mjs")) {
      throw new TypeError(`Unsupported scripts include pattern: ${pattern}`);
    }
    const directory = path.join(
      repositoryRoot,
      pattern.slice(0, -(recursive ? "/**/*.mjs" : "/*.mjs").length),
    );
    if (
      statSync(directory, { throwIfNoEntry: false })?.isDirectory() === true
    ) {
      collect(directory, recursive);
    }
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
