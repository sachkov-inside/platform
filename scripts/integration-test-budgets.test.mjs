// @ts-check
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { parseSync, Visitor } from "oxc-parser";

const backendRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../apps/backend",
);
const integrationDirectory = "test/integration";

/**
 * Правило и его причина записаны над бюджетами в `vitest.integration.config.mts`: свой срок ниже
 * общего тесту не нужен. Проверка ловит такой срок у теста, `describe` и хука. Ожидания вроде
 * `eventually(..., N)` и сроки `$transaction(..., { timeout })` бюджетами Vitest не являются и сюда
 * не попадают.
 */
const testCalls = new Set(["test", "it", "describe", "suite"]);
const hookCalls = new Set(["beforeAll", "beforeEach", "afterAll", "afterEach"]);

/** @typedef {import("oxc-parser").Node} Node */

/**
 * Имя в корне вызова: `test`, `test.skip`, `describe.sequential`, `test.each(table)`.
 *
 * @param {Node} callee
 * @returns {string | undefined}
 */
function rootName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") return rootName(callee.object);
  if (callee.type === "CallExpression") return rootName(callee.callee);
  return undefined;
}

/**
 * Число из литерала, константы модуля и арифметики над ними; иначе `undefined`.
 *
 * @param {Node} node
 * @param {ReadonlyMap<string, number>} constants
 * @returns {number | undefined}
 */
function evaluate(node, constants) {
  switch (node.type) {
    case "Literal":
      return typeof node.value === "number" ? node.value : undefined;
    case "Identifier":
      return constants.get(node.name);
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return evaluate(node.expression, constants);
    case "BinaryExpression": {
      const left = evaluate(node.left, constants);
      const right = evaluate(node.right, constants);
      if (left === undefined || right === undefined) return undefined;
      if (node.operator === "+") return left + right;
      if (node.operator === "-") return left - right;
      if (node.operator === "*") return left * right;
      if (node.operator === "/") return left / right;
      return undefined;
    }
    default:
      return undefined;
  }
}

/**
 * @param {import("oxc-parser").Program} program
 * @returns {Map<string, number>}
 */
function moduleConstants(program) {
  /** @type {Map<string, number>} */
  const constants = new Map();
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    if (declaration.kind !== "const") continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id.type !== "Identifier" || declarator.init === null)
        continue;
      const value = evaluate(declarator.init, constants);
      if (value !== undefined) constants.set(declarator.id.name, value);
    }
  }
  return constants;
}

/**
 * Выражение срока Vitest у вызова: число после функции или `timeout` в объекте параметров.
 *
 * @param {import("oxc-parser").CallExpression} call
 * @returns {Node | undefined}
 */
function budgetArgument(call) {
  const functionIndex = call.arguments.findIndex(
    (argument) =>
      argument.type === "ArrowFunctionExpression" ||
      argument.type === "FunctionExpression",
  );
  if (functionIndex === -1) return undefined;
  for (const [index, argument] of call.arguments.entries()) {
    if (argument.type === "ObjectExpression") {
      const timeout = argument.properties.find(
        (property) =>
          property.type === "Property" &&
          property.key.type === "Identifier" &&
          property.key.name === "timeout",
      );
      if (timeout?.type === "Property") return timeout.value;
    } else if (index > functionIndex && argument.type !== "SpreadElement") {
      return argument;
    }
  }
  return undefined;
}

/**
 * Сроки тестов и хуков ниже общего: файл, строка, срок и общий бюджет.
 *
 * @param {ReadonlyMap<string, string>} sources путь → текст файла
 * @param {{ test: number; hook: number }} defaults общие бюджеты
 * @returns {string[]}
 */
export function budgetsBelowDefault(sources, defaults) {
  /** @type {string[]} */
  const violations = [];
  for (const [file, source] of sources) {
    const { program, errors } = parseSync(file, source, { lang: "ts" });
    assert.deepEqual(errors, [], `${file} must parse`);
    const constants = moduleConstants(program);
    /** @param {number} offset */
    const lineOf = (offset) => source.slice(0, offset).split("\n").length;
    new Visitor({
      CallExpression(call) {
        const name = rootName(call.callee);
        if (name === undefined) return;
        const kind = testCalls.has(name)
          ? "test"
          : hookCalls.has(name)
            ? "hook"
            : undefined;
        if (kind === undefined) return;
        const budget = budgetArgument(call);
        if (budget === undefined) return;
        const where = `${file}:${String(lineOf(budget.start))}`;
        const value = evaluate(budget, constants);
        if (value === undefined)
          violations.push(
            `${where}: ${kind} budget cannot be evaluated; name it with a constant`,
          );
        else if (value < defaults[kind])
          violations.push(
            `${where}: ${kind} budget ${String(value)} ms is below the default ${String(defaults[kind])} ms`,
          );
      },
    }).visit(program);
  }
  return violations;
}

/** @returns {{ test: number; hook: number }} */
function configuredDefaults() {
  const file = "vitest.integration.config.mts";
  const { program } = parseSync(
    file,
    readFileSync(resolve(backendRoot, file), "utf8"),
  );
  const constants = moduleConstants(program);
  const test = constants.get("stuckTestBudgetMs");
  const hook = constants.get("stuckHookBudgetMs");
  assert.ok(
    test !== undefined && hook !== undefined,
    `${file} must declare stuckTestBudgetMs and stuckHookBudgetMs`,
  );
  return { test, hook };
}

/** @returns {Map<string, string>} */
function integrationSources() {
  /** @type {Map<string, string>} */
  const sources = new Map();
  for (const entry of readdirSync(resolve(backendRoot, integrationDirectory), {
    encoding: "utf8",
    recursive: true,
  })) {
    if (!entry.endsWith(".ts")) continue;
    const path = `${integrationDirectory}/${entry.split("\\").join("/")}`;
    sources.set(path, readFileSync(resolve(backendRoot, path), "utf8"));
  }
  return sources;
}

const defaults = { test: 30_000, hook: 60_000 };

describe("integration test budgets", () => {
  it("no integration test or hook names a budget below the default", () => {
    const sources = integrationSources();

    assert.ok(sources.size > 0);
    assert.deepEqual(budgetsBelowDefault(sources, configuredDefaults()), []);
  });

  it("names the file and line of a test or hook budget below the default", () => {
    const source = [
      "const budgetMs = 15_000;",
      'test("own number", async () => {}, 20_000);',
      'test("own constant", async () => {}, budgetMs);',
      'test("options", { timeout: budgetMs + 5_000 }, async () => {});',
      "beforeAll(async () => {}, 30_000);",
      'describe.sequential("suite", () => {}, 10_000);',
      'test.each([1])("each %s", async () => {}, 1_000);',
    ].join("\n");

    assert.deepEqual(
      budgetsBelowDefault(new Map([["a.test.ts", source]]), defaults),
      [
        "a.test.ts:2: test budget 20000 ms is below the default 30000 ms",
        "a.test.ts:3: test budget 15000 ms is below the default 30000 ms",
        "a.test.ts:4: test budget 20000 ms is below the default 30000 ms",
        "a.test.ts:5: hook budget 30000 ms is below the default 60000 ms",
        "a.test.ts:6: test budget 10000 ms is below the default 30000 ms",
        "a.test.ts:7: test budget 1000 ms is below the default 30000 ms",
      ],
    );
  });

  it("leaves waits, transaction timeouts and budgets at or above the default alone", () => {
    const source = [
      'test("waits", async () => {',
      "  await eventually(async () => {}, 5_000);",
      "  await db.$transaction(async () => {}, { timeout: 10_000 });",
      "  await vi.waitFor(() => {}, { timeout: 1_000 });",
      "}, 30_000);",
      'it("longer", async () => {}, 45_000);',
      "afterAll(async () => {}, 60_000);",
      'test("default", async () => {});',
    ].join("\n");

    assert.deepEqual(
      budgetsBelowDefault(new Map([["b.test.ts", source]]), defaults),
      [],
    );
  });

  it("refuses a budget it cannot evaluate", () => {
    const source = 'test("dynamic", async () => {}, budget());';

    assert.deepEqual(
      budgetsBelowDefault(new Map([["c.test.ts", source]]), defaults),
      ["c.test.ts:1: test budget cannot be evaluated; name it with a constant"],
    );
  });
});
