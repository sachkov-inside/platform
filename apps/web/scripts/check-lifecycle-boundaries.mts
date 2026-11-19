import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { type Node, parseSync } from "oxc-parser";

const hooks = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);
const timers = new Set(["setTimeout", "setInterval"]);
const keys = {
  path: z.string(),
  owner: z.string(),
  kind: z.string(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
};
const manifestSchema = z.object({
  pins: z.array(
    z.object({
      path: z.string(),
      owner: z.string(),
      kind: z.string(),
      name: z.string(),
    }),
  ),
  rows: z.array(
    z.object({
      ...keys,
      id: z.string(),
      status: z.enum([
        "reviewed-batch",
        "reviewed-timer",
        "approved-boundary",
        "verified-adapter",
        "retained-design",
        "frozen-blocked",
      ]),
      disposition: z
        .enum(["adapter", "proof", "extract", "command", "model", "diagnose"])
        .optional(),
      next: z.string().min(1).optional(),
      reason: z.string().optional(),
      test: z.string().optional(),
      additionalTests: z.array(z.string().min(1)).optional(),
    }),
  ),
});
type Manifest = z.infer<typeof manifestSchema>;
type Pin = Manifest["pins"][number];
type Row = Manifest["rows"][number];
interface Call {
  path: string;
  owner: string;
  kind: string;
  fingerprint: string;
  line: number;
  immediate?: boolean;
}
interface Finding {
  code: string;
  path: string;
  owner: string;
  line?: number;
  id?: string;
  disposition?: Row["disposition"];
  next?: Row["next"];
  testPath?: string;
}
interface Inventory {
  calls: Call[];
  diagnostics: Finding[];
}
type MaybeNode = Node | null | undefined;
function nameOf(node: MaybeNode): string {
  return node?.type === "Identifier"
    ? node.name
    : node?.type === "Literal" && typeof node.value === "string"
      ? node.value
      : "";
}
const ignoredKeys = new Set([
  "start",
  "end",
  "loc",
  "range",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
]);

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value === null || typeof value !== "object") return value;
  const isLiteral = "type" in value && value.type === "Literal";
  const entries: [string, unknown][] = Object.entries(value);
  return Object.fromEntries(
    entries
      .filter(([key]) => !ignoredKeys.has(key) && !(isLiteral && key === "raw"))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, normalized(item)]),
  );
}
function digest(node: Node) {
  return createHash("sha256")
    .update(JSON.stringify(normalized(node)))
    .digest("hex");
}

function literalName(node: MaybeNode): string | undefined {
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;
  if (node?.type === "BinaryExpression" && node.operator === "+") {
    const left = literalName(node.left),
      right = literalName(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}

function property(node: MaybeNode): string {
  if (node?.type !== "MemberExpression") return "";
  return node.computed
    ? (literalName(node.property) ?? "")
    : nameOf(node.property);
}

function patternNames(pattern: MaybeNode, scope: Set<string>) {
  if (pattern?.type === "Identifier") scope.add(pattern.name);
  else if (pattern?.type === "AssignmentPattern")
    patternNames(pattern.left, scope);
  else if (pattern?.type === "RestElement")
    patternNames(pattern.argument, scope);
  else if (pattern?.type === "ArrayPattern") {
    for (const item of pattern.elements) patternNames(item, scope);
  } else if (pattern?.type === "ObjectPattern") {
    for (const item of pattern.properties)
      patternNames(
        item.type === "RestElement" ? item.argument : item.value,
        scope,
      );
  }
}

function declaredNames(body: readonly Node[], scope: Set<string>) {
  for (const item of body) {
    const node = ("declaration" in item ? item.declaration : null) ?? item;
    if (node.type === "ClassDeclaration" || node.type === "FunctionDeclaration")
      patternNames(node.id, scope);
    if (node.type === "VariableDeclaration") {
      for (const declarator of node.declarations)
        patternNames(declarator.id, scope);
    }
  }
}

function isNode(value: unknown): value is Node {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string" &&
    "start" in value
  );
}
function walkChildren(node: Node, visit: (child: Node) => void) {
  const children: unknown[] = Object.values(node);
  for (const child of children) {
    if (Array.isArray(child)) {
      for (const item of child) if (isNode(item)) visit(item);
    } else if (isNode(child)) visit(child);
  }
}

function reference(node: Node, parent: MaybeNode) {
  if (!parent) return true;
  if (
    ((parent.type === "MemberExpression" && parent.property === node) ||
      ((parent.type === "Property" ||
        parent.type === "MethodDefinition" ||
        parent.type === "PropertyDefinition") &&
        parent.key === node)) &&
    !parent.computed
  )
    return false;
  if (parent.type === "VariableDeclarator" && parent.id === node) return false;
  return true;
}

// Inspect executable syntax only. Imports alone grant no permission to call or forward a hook.
export function inspectSource(
  path: string,
  source: string,
  pins: Pin[] = [],
): Inventory {
  const { program, errors } = parseSync(path, source);
  if (errors.length > 0)
    throw new Error(path + ": " + errors.map((e) => e.message).join(", "));
  const calls: Call[] = [],
    diagnostics: Finding[] = [];
  const bindings = new Map<string, string>(),
    nodeTimers = new Map<string, { name: string; delayIndex: number }>(),
    imports = new Set<string>();
  const line = (node: Node) => source.slice(0, node.start).split("\n").length;
  const report = (code: string, node: Node, owner: string) =>
    diagnostics.push({ code, path, line: line(node), owner });
  for (const decl of program.body) {
    if (decl.type !== "ImportDeclaration" || decl.importKind === "type")
      continue;
    for (const spec of decl.specifiers) {
      if (spec.type === "ImportSpecifier" && spec.importKind === "type")
        continue;
      const name = spec.type === "ImportSpecifier" ? nameOf(spec.imported) : "";
      imports.add(spec.local.name);
      if (/^(?:node:)?timers(?:\/promises)?$/u.test(decl.source.value)) {
        if (timers.has(name) || name === "" || name === "default")
          nodeTimers.set(spec.local.name, {
            name,
            delayIndex: decl.source.value.endsWith("/promises") ? 0 : 1,
          });
      }
      if (decl.source.value !== "react") continue;
      if (name === "" || name === "default")
        bindings.set(spec.local.name, "namespace");
      else if (hooks.has(name)) bindings.set(spec.local.name, name);
    }
  }
  function visit(
    node: Node,
    parent: MaybeNode,
    scope: Set<string>,
    owner: string,
  ) {
    if (
      (node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
      node.id
    ) {
      owner = owner === "" ? node.id.name : owner + "/" + node.id.name;
    }
    // Most TS nodes are type-only. Namespaces, enum initializers and parameter defaults run.
    if (node.type === "TSModuleDeclaration") {
      if (!node.declare && node.body)
        visit(
          node.body,
          node,
          scope,
          owner === "" ? nameOf(node.id) : owner + "/" + nameOf(node.id),
        );
      return;
    }
    if (node.type === "TSModuleBlock") {
      const local = new Set(scope);
      declaredNames(node.body, local);
      for (const statement of node.body) visit(statement, node, local, owner);
      return;
    }
    if (node.type === "TSEnumDeclaration") {
      if (!node.declare)
        for (const member of node.body.members)
          if (member.initializer)
            visit(member.initializer, member, scope, owner);
      return;
    }
    if (node.type === "TSParameterProperty") {
      visit(node.parameter, node, scope, owner);
      return;
    }
    if (
      node.type === "TSImportEqualsDeclaration" &&
      node.importKind !== "type" &&
      node.moduleReference.type === "TSExternalModuleReference" &&
      node.moduleReference.expression.value === "react"
    ) {
      report("indirect-react-import", node, owner);
      return;
    }
    if (node.type.startsWith("TS")) {
      if (
        "expression" in node &&
        isNode(node.expression) &&
        [
          "TSAsExpression",
          "TSTypeAssertion",
          "TSSatisfiesExpression",
          "TSNonNullExpression",
          "TSInstantiationExpression",
          "TSExportAssignment",
        ].includes(node.type)
      )
        visit(node.expression, node, scope, owner);
      return;
    }
    if (node.type === "ImportDeclaration") return;
    if (
      node.type === "ExportAllDeclaration" ||
      node.type === "ExportNamedDeclaration"
    ) {
      if (node.exportKind === "type") return;
      if (
        node.source?.value === "react" &&
        (node.type === "ExportAllDeclaration" ||
          node.specifiers.some(
            (s) =>
              s.exportKind !== "type" &&
              (hooks.has(nameOf(s.local)) || nameOf(s.local) === "default"),
          ))
      )
        report("react-reexport", node, owner);
      if (node.type === "ExportNamedDeclaration" && node.declaration)
        visit(node.declaration, node, scope, owner);
      if (node.type === "ExportNamedDeclaration" && !node.source) {
        for (const spec of node.specifiers) {
          if (spec.exportKind !== "type" && bindings.has(nameOf(spec.local)))
            report("react-reexport", spec, owner);
        }
      }
      return;
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      scope = new Set(scope);
      for (const parameter of node.params) patternNames(parameter, scope);
      const name = [
        "id" in node ? nameOf(node.id) : "",
        parent && "id" in parent ? nameOf(parent.id) : "",
        parent && "key" in parent ? nameOf(parent.key) : "",
      ].find((value) => value !== "");
      if (name !== undefined) owner = owner === "" ? name : owner + "/" + name;
    } else if (node.type === "BlockStatement" || node.type === "Program") {
      scope = new Set(scope);
      declaredNames(node.body, scope);
    } else if (
      node.type === "CatchClause" ||
      node.type === "ForOfStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForStatement"
    ) {
      scope = new Set(scope);
      if (node.type === "CatchClause") patternNames(node.param, scope);
      else {
        const decl = node.type === "ForStatement" ? node.init : node.left;
        if (decl) declaredNames([decl], scope);
      }
    }
    const pinName =
      node.type === "VariableDeclarator"
        ? nameOf(node.id)
        : node.type === "AssignmentPattern"
          ? nameOf(node.left)
          : node.type === "CallExpression"
            ? nameOf(node.callee)
            : undefined;
    if (pinName !== undefined && pinName !== "") {
      const pinKind =
        node.type === "VariableDeclarator"
          ? "constant"
          : node.type === "AssignmentPattern"
            ? "default"
            : "caller";
      for (const pin of pins) {
        if (pin.owner === owner && pin.kind === pinKind && pin.name === pinName)
          calls.push({
            path,
            owner,
            kind: pinKind + ":" + pinName,
            line: line(node),
            fingerprint: digest(node),
          });
      }
    }
    const binding = (name: string) =>
      scope.has(name) ? undefined : bindings.get(name);
    if (
      (node.type === "ImportExpression" && nameOf(node.source) === "react") ||
      (node.type === "CallExpression" &&
        nameOf(node.callee) === "require" &&
        nameOf(node.arguments[0]) === "react")
    ) {
      report("indirect-react-import", node, owner);
    }
    function isReactNamespace(candidate: Node): boolean {
      if (candidate.type === "Identifier")
        return binding(candidate.name) === "namespace";
      return (
        candidate.type === "MemberExpression" &&
        property(candidate) === "default" &&
        isReactNamespace(candidate.object)
      );
    }
    function classify(candidate: Node): string | undefined {
      if (candidate.type === "Identifier") {
        const name = binding(candidate.name);
        if (name !== undefined && hooks.has(name)) return name;
        if (
          !scope.has(candidate.name) &&
          timers.has(nodeTimers.get(candidate.name)?.name ?? "")
        )
          return nodeTimers.get(candidate.name)?.name;
        if (
          !scope.has(candidate.name) &&
          !imports.has(candidate.name) &&
          timers.has(candidate.name)
        )
          return candidate.name;
      }
      if (candidate.type === "MemberExpression") {
        const name = property(candidate);
        if (isReactNamespace(candidate.object) && hooks.has(name)) return name;
        if (timers.has(name)) return name;
      }
      return undefined;
    }
    if (
      node.type === "ObjectPattern" &&
      node.properties.some((p) =>
        timers.has(p.type === "RestElement" ? "" : nameOf(p.key)),
      )
    )
      report("indirect-lifecycle-reference", node, owner);
    if (isFrame(node)) {
      const callback = node.arguments[0];
      const body =
        callback?.type === "ArrowFunctionExpression" ||
        callback?.type === "FunctionExpression"
          ? callback.body
          : undefined;
      const next =
        body?.type === "BlockStatement" && body.body.length === 1
          ? body.body[0]?.type === "ExpressionStatement"
            ? body.body[0].expression
            : body.body[0]?.type === "ReturnStatement"
              ? body.body[0].argument
              : undefined
          : body;
      if (isFrame(next)) report("nested-frame-review", node, owner);
    }
    if (node.type === "CallExpression") {
      const kind = classify(node.callee);
      if (kind !== undefined) {
        calls.push({
          path,
          owner,
          kind,
          line: line(node),
          fingerprint: digest(node),
          ...(timers.has(kind) && {
            immediate: immediateDelay(
              node.arguments[
                nodeTimers.get(
                  node.callee.type === "MemberExpression"
                    ? nameOf(node.callee.object)
                    : nameOf(node.callee),
                )?.delayIndex ?? 1
              ],
            ),
          }),
        });
        for (const arg of node.arguments) visit(arg, node, scope, owner);
        return;
      }
    }
    if (
      node.type === "MemberExpression" &&
      isReactNamespace(node.object) &&
      node.computed &&
      property(node) === ""
    )
      report("computed-react-member", node, owner);
    if (
      (node.type === "Identifier" || node.type === "MemberExpression") &&
      isReactNamespace(node) &&
      reference(node, parent) &&
      !(parent?.type === "MemberExpression" && parent.object === node)
    )
      report("react-namespace-reference", node, owner);
    if (
      (node.type === "Identifier" || node.type === "MemberExpression") &&
      reference(node, parent) &&
      classify(node) !== undefined
    )
      report("indirect-lifecycle-reference", node, owner);
    walkChildren(node, (child) => {
      visit(child, node, scope, owner);
    });
  }
  visit(program, null, new Set(), "");
  return { calls, diagnostics };
}

function isFrame(
  node: MaybeNode,
): node is Extract<Node, { type: "CallExpression" }> {
  return (
    node?.type === "CallExpression" &&
    (node.callee.type === "MemberExpression"
      ? property(node.callee)
      : nameOf(node.callee)) === "requestAnimationFrame"
  );
}
function immediateDelay(node: MaybeNode) {
  if (!node) return true;
  if (node.type === "Literal") return Number(node.value) <= 0;
  if (node.type === "Identifier") return node.name === "undefined";
  if (node.type === "UnaryExpression")
    return (
      node.operator === "void" ||
      (node.operator === "-" &&
        node.argument.type === "Literal" &&
        Number(node.argument.value) >= 0)
    );
  return false;
}

function key(row: Pick<Call, "owner" | "path" | "kind" | "fingerprint">) {
  return JSON.stringify([row.path, row.owner, row.kind, row.fingerprint]);
}

function isEffectBoundary(row: Row): boolean {
  return (
    row.status === "approved-boundary" || row.status === "verified-adapter"
  );
}

export function compareInventory(
  { calls, diagnostics }: Inventory,
  rows: readonly Row[],
  mode: string,
): Finding[] {
  const expected = new Map<string, Row>();
  for (const row of rows) {
    if (expected.has(key(row))) throw new Error("Duplicate boundary " + row.id);
    expected.set(key(row), row);
  }
  const findings = [...diagnostics];
  for (const call of calls) {
    const row = expected.get(key(call));
    if (!row) {
      findings.push({
        ...call,
        code: call.kind.includes(":")
          ? "changed-timing-input"
          : timers.has(call.kind)
            ? call.immediate === true
              ? "ordering-timer"
              : "new-timer-review"
            : "new-effect",
      });
      continue;
    }
    expected.delete(key(call));
    if (hooks.has(call.kind) && row.status === "reviewed-timer")
      throw new Error("Timer status cannot authorize an effect " + row.id);
    if (call.immediate === true && row.status !== "reviewed-batch") {
      findings.push({ ...call, code: "ordering-timer", id: row.id });
      continue;
    }
    if (
      isEffectBoundary(row) &&
      ((row.reason ?? "") === "" || (row.test ?? "") === "")
    )
      throw new Error(
        "Approved boundary requires a reason and a public test " + row.id,
      );
    if (
      row.status === "reviewed-batch" &&
      (call.kind !== "setTimeout" || call.immediate !== true)
    )
      throw new Error("Batch status requires a timeout " + row.id);
    if (
      mode === "final" &&
      !isEffectBoundary(row) &&
      !["reviewed-timer", "reviewed-batch"].includes(row.status)
    )
      findings.push({
        ...call,
        code: row.status,
        id: row.id,
        disposition: row.disposition,
        next: row.next,
      });
  }
  for (const row of expected.values())
    findings.push({ ...row, code: "missing-or-moved" });
  return findings;
}

function sourceFiles(dir: string, root: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = join(dir, entry.name);
    if (entry.isDirectory()) {
      const path = relative(root, name).split(sep).join("/");
      return [
        "apps/web/src/storybook",
        "apps/web/src/shared/api/backend/generated",
      ].includes(path)
        ? []
        : sourceFiles(name, root);
    }
    return /\.[cm]?[jt]sx?$/u.test(name) &&
      !/\.(stories|test|fixtures)\.[cm]?[jt]sx?$/u.test(entry.name)
      ? [name]
      : [];
  });
}

export function inspectTree(root: string, pins: Pin[] = []): Inventory {
  const total: Inventory = { calls: [], diagnostics: [] };
  for (const dir of ["apps/web/app", "apps/web/src"]) {
    for (const file of sourceFiles(join(root, dir), root).sort()) {
      const path = relative(root, file).split(sep).join("/");
      const result = inspectSource(
        path,
        readFileSync(file, "utf8"),
        pins.filter((pin) => pin.path === path),
      );
      total.calls.push(...result.calls);
      total.diagnostics.push(...result.diagnostics);
    }
  }
  return total;
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const mode = process.argv[2];
  if ((mode !== "audit" && mode !== "final") || process.argv.length > 4)
    throw new Error(
      "Usage: node apps/web/scripts/check-lifecycle-boundaries.mts audit|final [repository-root]",
    );
  const root = resolve(
    process.argv[3] ?? fileURLToPath(new URL("../../..", import.meta.url)),
  );
  const { rows, pins } = manifestSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("./lifecycle-inventory.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const ids = new Set<string>();
  for (const row of rows) {
    if (
      row.status === "retained-design" &&
      (row.disposition === undefined || row.next === undefined)
    )
      throw new Error(
        "Retained call requires a disposition and a next step " + row.id,
      );
    if (isEffectBoundary(row) && !hooks.has(row.kind))
      throw new Error("Effect boundary requires a React hook " + row.id);
    if (ids.has(row.id)) throw new Error("Duplicate inventory ID " + row.id);
    ids.add(row.id);
  }
  const result = inspectTree(root, pins);
  const findings = compareInventory(result, rows, mode);
  for (const row of rows) {
    if (!isEffectBoundary(row)) continue;
    for (const test of [row.test ?? "", ...(row.additionalTests ?? [])]) {
      const target = resolve(root, test);
      if (
        !test.startsWith("apps/web/") ||
        relative(root, target).split(sep).join("/") !== test ||
        !/\.(stories|spec|test)\.[cm]?[jt]sx?$/u.test(test) ||
        statSync(target, { throwIfNoEntry: false })?.isFile() !== true
      )
        findings.push({
          code: "missing-boundary-test",
          testPath: test,
          path: row.path,
          owner: row.owner,
          id: row.id,
        });
    }
  }
  console.log(
    JSON.stringify(
      {
        mode,
        effects: result.calls.filter((c) => hooks.has(c.kind)).length,
        timers: result.calls.filter((c) => timers.has(c.kind)).length,
        timingInputs: result.calls.filter((c) => c.kind.includes(":")).length,
        findings,
      },
      null,
      2,
    ),
  );
  process.exitCode = findings.length > 0 ? 1 : 0;
}
