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

/** Модификаторы Vitest между именем и вызовом: `test.skip`, `describe.each(table)`. */
const modifiers = new Set([
  "concurrent",
  "each",
  "fails",
  "for",
  "only",
  "runIf",
  "sequential",
  "shuffle",
  "skip",
  "skipIf",
  "todo",
]);

/**
 * Имя в корне вызова: `test`, `test.skip`, `describe.sequential`, `test.each(table)`,
 * ``test.each`table` ``. Цепочка с другим свойством (`item.push`) вызовом Vitest не считается.
 *
 * @param {Node} callee
 * @returns {string | undefined}
 */
function rootName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression")
    return callee.property.type === "Identifier" &&
      modifiers.has(callee.property.name)
      ? rootName(callee.object)
      : undefined;
  if (callee.type === "CallExpression") return rootName(callee.callee);
  if (callee.type === "TaggedTemplateExpression") return rootName(callee.tag);
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
 * Значение свойства с ключом `name` или `"name"` в литерале объекта.
 *
 * @param {Node} node
 * @param {string} name
 * @returns {Node | undefined}
 */
function propertyValue(node, name) {
  if (node.type !== "ObjectExpression") return undefined;
  for (const property of node.properties) {
    if (property.type !== "Property") continue;
    const { key } = property;
    if (
      (key.type === "Identifier" && key.name === name) ||
      (key.type === "Literal" && key.value === name)
    )
      return property.value;
  }
  return undefined;
}

/**
 * Выражение срока по сигнатурам Vitest: `hook(fn, timeout)`, `test(name, fn, timeout)` и
 * `test(name, options, fn)`. Тело и параметры могут прийти ссылками. Тогда третий аргумент
 * считается сроком, только если второй — функция или третий вычисляется в число.
 *
 * @param {import("oxc-parser").CallExpression} call
 * @param {"test" | "hook"} kind
 * @param {ReadonlyMap<string, number>} constants
 * @returns {Node | undefined}
 */
function budgetArgument(call, kind, constants) {
  const [, second, third] = call.arguments;
  if (kind === "hook") return second;
  if (second?.type === "ObjectExpression")
    return propertyValue(second, "timeout");
  if (third === undefined) return undefined;
  if (
    second?.type === "ArrowFunctionExpression" ||
    second?.type === "FunctionExpression"
  )
    return third;
  return evaluate(third, constants) === undefined ? undefined : third;
}

/**
 * `vi.setConfig({ testTimeout, hookTimeout })` меняет общий бюджет файла.
 *
 * @param {import("oxc-parser").CallExpression} call
 * @returns {[("test" | "hook"), Node][]}
 */
function configuredBudgets(call) {
  const { callee } = call;
  if (
    callee.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    callee.object.name !== "vi" ||
    callee.property.type !== "Identifier" ||
    callee.property.name !== "setConfig"
  )
    return [];
  const [options] = call.arguments;
  if (options === undefined) return [];
  /** @type {[("test" | "hook"), Node][]} */
  const budgets = [];
  const test = propertyValue(options, "testTimeout");
  const hook = propertyValue(options, "hookTimeout");
  if (test !== undefined) budgets.push(["test", test]);
  if (hook !== undefined) budgets.push(["hook", hook]);
  return budgets;
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
    /**
     * @param {"test" | "hook"} kind
     * @param {Node | undefined} budget
     */
    const check = (kind, budget) => {
      if (budget === undefined || budget.type === "SpreadElement") return;
      const line = source.slice(0, budget.start).split("\n").length;
      const where = `${file}:${String(line)}: ${kind} budget`;
      const value = evaluate(budget, constants);
      if (value === undefined)
        violations.push(
          `${where} cannot be evaluated; name it with a module-level constant`,
        );
      else if (value === 0)
        violations.push(`${where} 0 ms turns off the stop for a stuck run`);
      else if (value < defaults[kind])
        violations.push(
          `${where} ${String(value)} ms is below the default ${String(defaults[kind])} ms`,
        );
    };
    new Visitor({
      CallExpression(call) {
        for (const [kind, budget] of configuredBudgets(call))
          check(kind, budget);
        const name = rootName(call.callee);
        if (name === undefined) return;
        if (testCalls.has(name))
          check("test", budgetArgument(call, "test", constants));
        else if (hookCalls.has(name))
          check("hook", budgetArgument(call, "hook", constants));
      },
    }).visit(program);
  }
  return violations;
}

/** @returns {{ test: number; hook: number }} */
function configuredDefaults() {
  const file = "vitest.integration.config.mts";
  const { program, errors } = parseSync(
    file,
    readFileSync(resolve(backendRoot, file), "utf8"),
  );
  assert.deepEqual(errors, [], `${file} must parse`);
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

const fixtureDefaults = { test: 30_000, hook: 60_000 };

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
      'test("by reference", body, 2_000);',
      "beforeEach(setup, 5_000);",
      'test("string key", { "timeout": 3_000 }, async () => {});',
      "vi.setConfig({ testTimeout: 4_000, hookTimeout: 50_000 });",
      'test("disabled", async () => {}, 0);',
      'test.each`a`("tagged %s", async () => {}, 6_000);',
    ].join("\n");

    assert.deepEqual(
      budgetsBelowDefault(new Map([["a.test.ts", source]]), fixtureDefaults),
      [
        "a.test.ts:2: test budget 20000 ms is below the default 30000 ms",
        "a.test.ts:3: test budget 15000 ms is below the default 30000 ms",
        "a.test.ts:4: test budget 20000 ms is below the default 30000 ms",
        "a.test.ts:5: hook budget 30000 ms is below the default 60000 ms",
        "a.test.ts:6: test budget 10000 ms is below the default 30000 ms",
        "a.test.ts:7: test budget 1000 ms is below the default 30000 ms",
        "a.test.ts:8: test budget 2000 ms is below the default 30000 ms",
        "a.test.ts:9: hook budget 5000 ms is below the default 60000 ms",
        "a.test.ts:10: test budget 3000 ms is below the default 30000 ms",
        "a.test.ts:11: test budget 4000 ms is below the default 30000 ms",
        "a.test.ts:11: hook budget 50000 ms is below the default 60000 ms",
        "a.test.ts:12: test budget 0 ms turns off the stop for a stuck run",
        "a.test.ts:13: test budget 6000 ms is below the default 30000 ms",
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
      'test("plain reference", body);',
      'test("options first", { retry: 0 }, async () => {});',
      'test.each([1])("each %s", async () => {});',
      "afterEach(teardown);",
      'test("options by reference", options, body);',
      "items.forEach((it) => it.push(a, b, c));",
    ].join("\n");

    assert.deepEqual(
      budgetsBelowDefault(new Map([["b.test.ts", source]]), fixtureDefaults),
      [],
    );
  });

  it("refuses a budget it cannot evaluate", () => {
    const source = 'test("dynamic", async () => {}, budget());';

    assert.deepEqual(
      budgetsBelowDefault(new Map([["c.test.ts", source]]), fixtureDefaults),
      [
        "c.test.ts:1: test budget cannot be evaluated; name it with a module-level constant",
      ],
    );
  });
});
