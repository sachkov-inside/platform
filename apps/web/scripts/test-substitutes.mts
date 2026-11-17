import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync, Visitor, type Node } from "oxc-parser";

interface Import {
  source: string;
  name: string;
}
interface Module {
  file: string;
  fingerprint: string;
  references: string[];
  imports: Map<string, Import>;
  definitions: Map<string, Node>;
  exports: Map<
    string,
    { source?: string | undefined; name: string; node?: Node }
  >;
  stars: string[];
  nodes: Node[];
}
interface Binding {
  module: Module;
  node: Node;
  name: string;
}
const webRoot = fileURLToPath(new URL("..", import.meta.url));
const modules = new Map<string, Module>();
// Explicit framework ports: https://github.com/sachkov-inside/platform/issues/2292
// AST fingerprints ignore comments, quotes and positions; API/body changes need a new decision.
const frameworkAdapters = new Map([
  [
    "file-preview/next-navigation.ts",
    {
      exports: [
        "ReadonlyURLSearchParams",
        "useParams",
        "usePathname",
        "useRouter",
        "useSearchParams",
      ],
      fingerprint:
        "98278692f97e28cc664a0f8bb6fc05374d2c1cc74f1a0b39fd6fc677ce5f4d5b",
    },
  ],
  [
    ".storybook/mocks/next-link.tsx",
    {
      exports: ["default", "useLinkStatus"],
      fingerprint:
        "2f8ed79726f4ddc0bcb24d6b658520c8ce5f862267b6d574b912f70ded3680fa",
    },
  ],
  [
    ".storybook/mocks/next-navigation.ts",
    {
      exports: [
        "ReadonlyURLSearchParams",
        "getStoryRouter",
        "useParams",
        "usePathname",
        "useRouter",
        "useSearchParams",
      ],
      fingerprint:
        "101564407702be9a80e02a0c3c4693efdce682bab3a054433a4a81e51c01ad6a",
    },
  ],
  [
    "test/support/course-reading-router.ts",
    {
      exports: ["releaseLocation", "usePathname", "useSearchParams"],
      fingerprint:
        "2d6860028f75b2689b6eac4fad856973b25c4e61d5f1f1373ae4bf97ac747146",
    },
  ],
  [
    "test/support/next-cache.ts",
    {
      exports: ["cacheLife", "cacheTag", "revalidateTag"],
      fingerprint:
        "c5fbe0d220751352e97857af0066043d5a15b36c4c6a375c2cd0fa308d598eef",
    },
  ],
  [
    "test/support/server-only.ts",
    {
      exports: [],
      fingerprint:
        "b157cb87e1ef172af8d13acc1639815e5a86fbb0c9149dac4913df3472440791",
    },
  ],
]);
const frameworkAliasContexts = new Map([
  [
    "test/browser-engines/owner-fact-announcements.test.ts",
    new Map([["next/navigation", "file-preview/next-navigation.ts"]]),
  ],
  [
    ".storybook/main.ts",
    new Map([
      ["next/link", ".storybook/mocks/next-link.tsx"],
      ["next/navigation", ".storybook/mocks/next-navigation.ts"],
    ]),
  ],
  [
    "test/browser-engines/course-reading-handoff.test.ts",
    new Map([
      ["next/link", ".storybook/mocks/next-link.tsx"],
      ["next/navigation", "test/support/course-reading-router.ts"],
    ]),
  ],
  [
    "vitest.config.mts",
    new Map([
      ["next/cache", "test/support/next-cache.ts"],
      ["server-only", "test/support/server-only.ts"],
    ]),
  ],
  [
    "vitest.smoke.config.mts",
    new Map([["server-only", "test/support/server-only.ts"]]),
  ],
]);
const storyRouterConsumers = new Set([
  "src/shared/ui/admin/admin.fixtures.tsx",
  "src/shared/ui/retry-page-button.stories.tsx",
  "src/_app/ui/use-access-change-refresh.stories.tsx",
  "src/_pages/task-submissions/ui/task-submissions-view.stories.tsx",
  "src/_pages/product-purchase/ui/product-purchase.stories.tsx",
]);
const extensions = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];
const modifications =
  /^(?:mockImplementation(?:Once)?|mockReturnValue(?:Once)?|mockResolvedValue(?:Once)?|mockRejectedValue(?:Once)?|withImplementation)$/u;
const spyReturningMethods = new Set(["mockName", "mockClear", "mockReset"]);

function unwrap(node: Node | null | undefined): Node | undefined {
  if (
    node?.type === "TSAsExpression" ||
    node?.type === "TSSatisfiesExpression" ||
    node?.type === "TSNonNullExpression" ||
    node?.type === "ParenthesizedExpression"
  )
    return unwrap(node.expression);
  return node ?? undefined;
}
function literal(node: Node | null | undefined): string | undefined {
  node = unwrap(node);
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}
function name(node: Node | null | undefined): string {
  return node?.type === "Identifier" ? node.name : (literal(node) ?? "");
}
function member(node: Node | null | undefined): string {
  return node?.type === "MemberExpression"
    ? node.computed
      ? (literal(node.property) ?? "")
      : name(node.property)
    : "";
}
function parse(file: string, source: string): Module {
  const { program, errors } = parseSync(file, source);
  if (errors.length !== 0)
    throw new SyntaxError(
      `Cannot inspect test substitutes in ${file}: ${errors[0]?.message ?? "unknown parse error"}`,
    );
  const info: Module = {
    file,
    references: [],
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify(program, (key, value: unknown) =>
          ["start", "end", "raw", "loc", "comments", "parent"].includes(key)
            ? undefined
            : value,
        ),
      )
      .digest("hex"),
    imports: new Map(),
    definitions: new Map(),
    exports: new Map(),
    stars: [],
    nodes: [],
  };
  for (const statement of program.body) {
    if (
      (statement.type === "ImportDeclaration" ||
        statement.type === "ExportAllDeclaration" ||
        statement.type === "ExportNamedDeclaration") &&
      statement.source
    )
      info.references.push(statement.source.value);
    if (
      statement.type === "ImportDeclaration" &&
      statement.importKind !== "type"
    ) {
      for (const specifier of statement.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          specifier.importKind === "type"
        )
          continue;
        info.imports.set(specifier.local.name, {
          source: statement.source.value,
          name:
            specifier.type === "ImportNamespaceSpecifier"
              ? "*"
              : specifier.type === "ImportDefaultSpecifier"
                ? "default"
                : name(specifier.imported),
        });
      }
    }
    if (statement.type === "ExportNamedDeclaration") {
      for (const specifier of statement.specifiers)
        info.exports.set(name(specifier.exported), {
          source: statement.source?.value,
          name: name(specifier.local),
        });
      const declaration = statement.declaration;
      if (
        declaration &&
        "id" in declaration &&
        declaration.id?.type === "Identifier"
      )
        info.exports.set(declaration.id.name, { name: declaration.id.name });
      if (declaration?.type === "VariableDeclaration")
        for (const item of declaration.declarations)
          if (item.id.type === "Identifier")
            info.exports.set(item.id.name, { name: item.id.name });
    }
    if (statement.type === "ExportAllDeclaration")
      info.stars.push(statement.source.value);
    if (statement.type === "ExportDefaultDeclaration")
      info.exports.set("default", {
        name: "default",
        node: statement.declaration,
      });
  }
  new Visitor({
    FunctionDeclaration(node) {
      if (node.id) info.definitions.set(node.id.name, node);
    },
    VariableDeclarator(node) {
      info.nodes.push(node);
      if (node.id.type === "Identifier" && node.init)
        info.definitions.set(node.id.name, node.init);
      const value = unwrap(node.init);
      const source =
        value?.type === "AwaitExpression" &&
        value.argument.type === "ImportExpression"
          ? literal(value.argument.source)
          : undefined;
      if (source !== undefined) {
        if (node.id.type === "Identifier")
          info.imports.set(node.id.name, { source, name: "*" });
        if (node.id.type === "ObjectPattern")
          for (const property of node.id.properties)
            if (
              property.type === "Property" &&
              property.value.type === "Identifier"
            )
              info.imports.set(property.value.name, {
                source,
                name: name(property.key),
              });
      }
    },
    ImportExpression(node) {
      const source = literal(node.source);
      if (source !== undefined) info.references.push(source);
    },
    CallExpression(node) {
      info.nodes.push(node);
    },
    AssignmentExpression(node) {
      info.nodes.push(node);
    },
    Property(node) {
      info.nodes.push(node);
    },
  }).visit(program);
  return info;
}
function own(source: string): boolean {
  return (
    source.startsWith("@/") ||
    source.startsWith("@inside/") ||
    source.startsWith(".")
  );
}
function protectedImport(source: string): boolean {
  return own(source) || source.startsWith("@logto/");
}
function localModule(from: string, source: string): Module | undefined {
  const base = source.startsWith("@/")
    ? path.resolve(webRoot, "src", source.slice(2))
    : source.startsWith(".")
      ? path.resolve(path.dirname(from), source)
      : undefined;
  if (base === undefined) return;
  for (const file of [
    base,
    ...extensions.map((extension) => base + extension),
    ...extensions.map((extension) => path.join(base, "index" + extension)),
  ]) {
    if (
      !extensions.includes(path.extname(file)) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    )
      continue;
    let info = modules.get(file);
    if (!info) {
      info = parse(file, readFileSync(file, "utf8"));
      modules.set(file, info);
    }
    return info;
  }
  return undefined;
}
function exported(
  info: Module,
  symbol: string,
  seen = new Set<string>(),
): Binding | undefined {
  const key = info.file + "#" + symbol;
  if (seen.has(key)) return;
  seen.add(key);
  const value = info.exports.get(symbol);
  if (value?.node) return { module: info, node: value.node, name: symbol };
  if (value?.source !== undefined) {
    const target = localModule(info.file, value.source);
    return target && exported(target, value.name, seen);
  }
  if (value) return binding(info, value.name, seen);
  for (const source of info.stars) {
    const target = localModule(info.file, source);
    const found = target && exported(target, symbol, new Set(seen));
    if (found) return found;
  }
  return undefined;
}
function binding(
  info: Module,
  symbol: string,
  seen = new Set<string>(),
): Binding | undefined {
  const imported = info.imports.get(symbol);
  if (imported) {
    const target = localModule(info.file, imported.source);
    return target && exported(target, imported.name, seen);
  }
  const node = unwrap(info.definitions.get(symbol));
  if (node?.type === "Identifier") {
    const key = info.file + ":" + symbol;
    if (seen.has(key)) return;
    seen.add(key);
    return binding(info, node.name, seen);
  }
  return node ? { module: info, node, name: symbol } : undefined;
}
function calledBinding(info: Module, callee: Node): Binding | undefined {
  callee = unwrap(callee) ?? callee;
  if (callee.type === "Identifier") return binding(info, callee.name);
  if (callee.type !== "MemberExpression") return undefined;
  const object = unwrap(callee.object);
  if (object?.type === "Identifier") {
    const imported = info.imports.get(object.name);
    if (imported?.name === "*") {
      const target = localModule(info.file, imported.source);
      return target && exported(target, member(callee));
    }
  }
  if (
    object?.type === "AwaitExpression" &&
    object.argument.type === "ImportExpression"
  ) {
    const source = literal(object.argument.source);
    const target =
      source !== undefined ? localModule(info.file, source) : undefined;
    return target && exported(target, member(callee));
  }
  return undefined;
}
function callableDefault(
  info: Module,
  node: Node | null | undefined,
  seen = new Set<string>(),
): boolean {
  node = unwrap(node);
  if (!node) return false;
  if (node.type === "Identifier") {
    const key = info.file + "#" + node.name;
    if (seen.has(key)) return false;
    seen.add(key);
    const found = binding(info, node.name);
    return !!found && callableDefault(found.module, found.node, seen);
  }
  if (node.type === "ObjectExpression")
    return node.properties.some(
      (property) =>
        property.type === "Property" &&
        callableDefault(info, property.value, new Set(seen)),
    );
  if (
    [
      "FunctionDeclaration",
      "FunctionExpression",
      "ArrowFunctionExpression",
      "ClassDeclaration",
    ].includes(node.type)
  ) {
    if (
      node.type === "ArrowFunctionExpression" &&
      node.body.type === "NewExpression" &&
      node.body.callee.type === "Identifier" &&
      node.body.callee.name === "Date" &&
      node.body.arguments.length === 0 &&
      !info.imports.has("Date") &&
      !info.definitions.has("Date")
    )
      return false;
    return true;
  }
  return false;
}
function returned(node: Node | null | undefined): Node | undefined {
  node = unwrap(node);
  if (
    node?.type !== "ArrowFunctionExpression" &&
    node?.type !== "FunctionExpression"
  )
    return;
  if (!node.body) return undefined;
  if (node.body.type !== "BlockStatement") return unwrap(node.body);
  if (
    node.body.body.length === 1 &&
    node.body.body[0]?.type === "ReturnStatement"
  )
    return unwrap(node.body.body[0].argument);
  return undefined;
}
function objectProperties(
  node: Node | undefined,
): Map<string, Node> | undefined {
  if (
    node?.type !== "ObjectExpression" ||
    node.properties.some(
      (property) => property.type !== "Property" || property.computed,
    )
  )
    return;
  return new Map(
    node.properties.flatMap((property) =>
      property.type === "Property"
        ? [[name(property.key), property.value] as const]
        : [],
    ),
  );
}
function noop(node: Node | undefined): boolean {
  if (
    node?.type !== "ArrowFunctionExpression" ||
    node.async ||
    node.params.length !== 0
  )
    return false;
  return (
    (node.body.type === "Identifier" && node.body.name === "undefined") ||
    (node.body.type === "BlockStatement" && node.body.body.length === 0)
  );
}
function originalCall(node: Node | null | undefined, symbol: string): boolean {
  node = unwrap(node);
  return (
    node?.type === "AwaitExpression" &&
    node.argument.type === "CallExpression" &&
    node.argument.callee.type === "Identifier" &&
    node.argument.callee.name === symbol &&
    node.argument.arguments.length === 0
  );
}
function transparentFactory(
  factory: Node | undefined,
  observationOnly: (node: Node) => boolean,
): boolean {
  if (
    factory?.type !== "ArrowFunctionExpression" ||
    factory.params.length !== 1 ||
    factory.params[0]?.type !== "Identifier" ||
    factory.body.type !== "BlockStatement" ||
    factory.body.body.length !== 3
  )
    return false;
  const [declaration, observation, result] = factory.body.body;
  if (
    declaration?.type !== "VariableDeclaration" ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== 1
  )
    return false;
  const value = declaration.declarations[0];
  if (
    value?.id.type !== "Identifier" ||
    !originalCall(value.init, factory.params[0].name) ||
    result?.type !== "ReturnStatement" ||
    result.argument?.type !== "Identifier" ||
    result.argument.name !== value.id.name
  )
    return false;
  return (
    observation?.type === "ExpressionStatement" &&
    observation.expression.type === "CallExpression" &&
    observation.expression.arguments.every(
      (argument) => argument.type === "Literal",
    ) &&
    observation.expression.arguments.length > 0 &&
    observationOnly(observation.expression.callee)
  );
}
function retainedAfter(node: Node | undefined): boolean {
  if (
    node?.type !== "ArrowFunctionExpression" ||
    node.params.length !== 1 ||
    node.params[0]?.type !== "Identifier" ||
    node.body.type !== "BlockStatement" ||
    node.body.body.length !== 1
  )
    return false;
  const statement = node.body.body[0];
  return (
    statement?.type === "ExpressionStatement" &&
    statement.expression.type === "CallExpression" &&
    member(statement.expression.callee) === "push" &&
    statement.expression.arguments.length === 1 &&
    statement.expression.arguments[0]?.type === "Identifier" &&
    statement.expression.arguments[0].name === node.params[0].name
  );
}

/** Checks concrete test substitution forms and the API/context limits of decision #2292. */
export function testSubstituteViolations(
  sourcePath: string,
  source: string,
): string[] {
  const info = parse(path.resolve(webRoot, sourcePath), source);
  const violations = new Set<string>();
  const adapter = frameworkAdapters.get(sourcePath);
  if (
    adapter &&
    (info.fingerprint !== adapter.fingerprint ||
      [...info.exports.keys()].sort().join(",") !==
        [...adapter.exports].sort().join(",") ||
      info.stars.length !== 0)
  )
    violations.add(
      "framework adapter API or behavior changed outside its accepted boundary",
    );
  for (const reference of new Set(info.references)) {
    const resolved = localModule(info.file, reference);
    if (!resolved) continue;
    const target = path
      .relative(webRoot, resolved.file)
      .split(path.sep)
      .join("/");
    if (
      frameworkAdapters.has(target) &&
      !(
        (target === ".storybook/mocks/next-navigation.ts" &&
          storyRouterConsumers.has(sourcePath)) ||
        (target === "test/support/course-reading-router.ts" &&
          sourcePath === "test/support/course-reading-handoff.tsx")
      )
    )
      violations.add(
        "framework adapters stay in their approved fixture contexts",
      );
  }
  const apis = new Set(["vi", "sb"]);
  const methods = new Map<string, string>();
  const constants = new Map<string, string>();
  const owned = new Set<string>();
  const spies = new Set<string>();
  const mockedViews = new Set<string>();
  for (const [symbol, value] of info.imports) {
    if (protectedImport(value.source)) owned.add(symbol);
    if (
      (value.source === "vitest" && value.name === "vi") ||
      (value.source === "storybook/test" && value.name === "sb")
    )
      apis.add(symbol);
    if (value.source === "storybook/test" && value.name === "spyOn")
      methods.set(symbol, "spyOn");
    if (
      ["vitest", "storybook/test"].includes(value.source) &&
      value.name === "mocked"
    )
      mockedViews.add(symbol);
  }
  const rootOwn = (node: Node | null | undefined): boolean => {
    node = unwrap(node);
    if (node?.type === "Identifier") return owned.has(node.name);
    if (node?.type === "MemberExpression") return rootOwn(node.object);
    if (
      node?.type === "AwaitExpression" &&
      node.argument.type === "ImportExpression"
    )
      return protectedImport(literal(node.argument.source) ?? "");
    if (
      node?.type === "CallExpression" &&
      (apiMethod(node) === "mocked" ||
        (node.callee.type === "Identifier" &&
          mockedViews.has(node.callee.name)))
    )
      return rootOwn(node.arguments[0]);
    if (
      node?.type === "CallExpression" &&
      node.callee.type === "MemberExpression" &&
      spyReturningMethods.has(member(node.callee))
    )
      return rootOwn(node.callee.object);
    return false;
  };
  const apiMethod = (node: Node): string | undefined => {
    if (node.type !== "CallExpression") return;
    if (node.callee.type === "Identifier") return methods.get(node.callee.name);
    if (
      node.callee.type === "MemberExpression" &&
      node.callee.object.type === "Identifier" &&
      apis.has(node.callee.object.name)
    )
      return member(node.callee).length > 0
        ? member(node.callee)
        : node.callee.property.type === "Identifier"
          ? constants.get(node.callee.property.name)
          : undefined;
    return undefined;
  };
  const ownSpy = (node: Node | null | undefined): boolean => {
    node = unwrap(node);
    if (node?.type === "Identifier") return spies.has(node.name);
    if (node?.type !== "CallExpression") return false;
    if (apiMethod(node) === "spyOn") return rootOwn(node.arguments[0]);
    return (
      node.callee.type === "MemberExpression" &&
      spyReturningMethods.has(member(node.callee)) &&
      ownSpy(node.callee.object)
    );
  };
  for (let pass = 0; pass < 4; pass++)
    for (const node of info.nodes) {
      if (node.type !== "VariableDeclarator" || !node.init) continue;
      const value = unwrap(node.init);
      if (node.id.type === "Identifier") {
        const symbol = node.id.name;
        const text =
          literal(value) ??
          (value?.type === "Identifier"
            ? constants.get(value.name)
            : undefined);
        if (text !== undefined) constants.set(symbol, text);
        if (value?.type === "Identifier") {
          if (apis.has(value.name)) apis.add(symbol);
          const method = methods.get(value.name);
          if (method !== undefined) methods.set(symbol, method);
          if (owned.has(value.name)) owned.add(symbol);
          if (mockedViews.has(value.name)) mockedViews.add(symbol);
        }
        if (
          value?.type === "MemberExpression" &&
          value.object.type === "Identifier" &&
          apis.has(value.object.name)
        )
          methods.set(
            symbol,
            member(value).length > 0
              ? member(value)
              : ((value.property.type === "Identifier"
                  ? constants.get(value.property.name)
                  : undefined) ?? "<dynamic>"),
          );
        if (ownSpy(value)) spies.add(symbol);
        if (rootOwn(value)) owned.add(symbol);
        if (
          value?.type === "NewExpression" &&
          value.callee.type === "Identifier" &&
          own(info.imports.get(value.callee.name)?.source ?? "")
        )
          owned.add(symbol);
        if (
          value?.type === "AwaitExpression" &&
          value.argument.type === "ImportExpression" &&
          protectedImport(literal(value.argument.source) ?? "")
        )
          owned.add(symbol);
      }
      if (node.id.type === "ObjectPattern" && value?.type === "Identifier")
        for (const property of node.id.properties) {
          if (
            property.type !== "Property" ||
            property.value.type !== "Identifier"
          )
            continue;
          if (apis.has(value.name))
            methods.set(property.value.name, name(property.key));
          if (owned.has(value.name)) owned.add(property.value.name);
        }
    }
  const emptyMock = (
    node: Node | undefined,
    seen = new Set<string>(),
  ): boolean => {
    node = unwrap(node);
    if (noop(node)) return true;
    if (
      node?.type === "CallExpression" &&
      apiMethod(node) === "fn" &&
      node.arguments.length === 0
    )
      return true;
    if (node?.type === "Identifier" && !seen.has(node.name)) {
      seen.add(node.name);
      return emptyMock(info.definitions.get(node.name), seen);
    }
    if (
      node?.type === "MemberExpression" &&
      node.object.type === "Identifier"
    ) {
      const object = info.definitions.get(node.object.name);
      if (object?.type === "CallExpression" && apiMethod(object) === "hoisted")
        return emptyMock(
          objectProperties(returned(object.arguments[0]))?.get(member(node)),
          seen,
        );
    }
    return false;
  };
  const observationKey = (
    node: Node | undefined,
    seen = new Set<string>(),
  ): string => {
    if (node?.type === "Identifier") {
      if (seen.has(node.name)) return node.name;
      seen.add(node.name);
      const value = info.definitions.get(node.name);
      return value?.type === "Identifier" || value?.type === "MemberExpression"
        ? observationKey(value, seen)
        : node.name;
    }
    if (node?.type === "MemberExpression") {
      const root = observationKey(node.object, seen);
      return root.length > 0 && member(node).length > 0
        ? `${root}.${member(node)}`
        : "";
    }
    if (node?.type === "CallExpression") {
      if (apiMethod(node) === "mocked")
        return observationKey(node.arguments[0], seen);
      if (
        node.callee.type === "MemberExpression" &&
        spyReturningMethods.has(member(node.callee))
      )
        return observationKey(node.callee.object, seen);
    }
    return "";
  };
  const unchangedObservation = (node: Node): boolean => {
    if (!emptyMock(node)) return false;
    const key = observationKey(node);
    if (key.length === 0) return true;
    const changesRoot = (node: Node | undefined): boolean => {
      const target = observationKey(node);
      return (
        target.length > 0 && (target === key || key.startsWith(`${target}.`))
      );
    };
    return !info.nodes.some((candidate) => {
      if (candidate.type === "AssignmentExpression")
        return changesRoot(candidate.left);
      if (
        candidate.type !== "CallExpression" ||
        candidate.callee.type !== "MemberExpression"
      )
        return false;
      if (modifications.test(member(candidate.callee)))
        return observationKey(candidate.callee.object) === key;
      return (
        candidate.callee.object.type === "Identifier" &&
        ["Object", "Reflect"].includes(candidate.callee.object.name) &&
        ["assign", "defineProperty", "set"].includes(
          member(candidate.callee),
        ) &&
        changesRoot(candidate.arguments[0])
      );
    });
  };
  const platformFactory = (
    target: string,
    factory: Node | undefined,
  ): boolean => {
    const properties = objectProperties(returned(factory));
    if (target === "server-only")
      return (
        sourcePath === "test/module/logto-sdk-callback.test.ts" &&
        properties?.size === 0
      );
    if (target === "@storybook/addon-vitest/vitest-plugin") {
      const body = returned(properties?.get("storybookTest"));
      return (
        sourcePath === "test/contracts/run-scoped-vite-cache.test.ts" &&
        properties?.size === 1 &&
        body?.type === "ArrayExpression" &&
        body.elements.length === 0
      );
    }
    if (target === "next/cache")
      return (
        [
          "test/module/authoring-write-expires-catalog.test.ts",
          "test/module/mutation-operation.test.ts",
        ].includes(sourcePath) &&
        properties?.size === 3 &&
        ["cacheLife", "cacheTag", "revalidateTag"].every((key) => {
          const value = properties.get(key);
          return value !== undefined && unchangedObservation(value);
        })
      );
    if (target !== "next/server") return false;
    if (properties?.size === 1 && properties.has("after"))
      return [
        "test/module/client-report-limits.test.ts",
        "test/module/client-telemetry-bff.test.ts",
      ].includes(sourcePath)
        ? noop(properties.get("after"))
        : sourcePath === "test/module/web-telemetry-forwarding.test.ts" &&
            retainedAfter(properties.get("after"));
    if (
      sourcePath !== "test/support/request-scope.ts" ||
      factory?.type !== "ArrowFunctionExpression" ||
      factory.params[0]?.type !== "Identifier"
    )
      return false;
    const body = returned(factory);
    if (body?.type !== "ObjectExpression" || body.properties.length !== 2)
      return false;
    const [spread, property] = body.properties;
    if (
      spread?.type !== "SpreadElement" ||
      !originalCall(spread.argument, factory.params[0].name) ||
      property?.type !== "Property" ||
      name(property.key) !== "connection"
    )
      return false;
    const connection = returned(property.value);
    return (
      connection?.type === "CallExpression" &&
      connection.callee.type === "MemberExpression" &&
      connection.callee.object.type === "Identifier" &&
      connection.callee.object.name === "Promise" &&
      member(connection.callee) === "resolve" &&
      connection.arguments.length === 0
    );
  };
  const configuredPath = (
    node: Node | undefined,
    seen = new Set<string>(),
  ): string | undefined => {
    if (node?.type === "Identifier" && !seen.has(node.name)) {
      seen.add(node.name);
      return configuredPath(info.definitions.get(node.name), seen);
    }
    if (node?.type === "TemplateLiteral" && node.expressions.length === 1) {
      const root = configuredPath(node.expressions[0], seen);
      const prefix = node.quasis[0]?.value.cooked;
      const suffix = node.quasis[1]?.value.cooked;
      return root !== undefined && prefix === "" && typeof suffix === "string"
        ? path.resolve(root + suffix)
        : undefined;
    }
    if (
      node?.type !== "CallExpression" ||
      node.callee.type !== "Identifier" ||
      info.imports.get(node.callee.name)?.source !== "node:url" ||
      info.imports.get(node.callee.name)?.name !== "fileURLToPath" ||
      node.arguments.length !== 1
    )
      return undefined;
    const url = node.arguments[0];
    if (
      url?.type !== "NewExpression" ||
      url.callee.type !== "Identifier" ||
      url.callee.name !== "URL" ||
      url.arguments.length !== 2
    )
      return undefined;
    const relative = literal(url.arguments[0]);
    const base = url.arguments[1];
    return relative !== undefined &&
      base?.type === "MemberExpression" &&
      member(base) === "url" &&
      base.object.type === "MetaProperty" &&
      name(base.object.meta) === "import" &&
      name(base.object.property) === "meta"
      ? path.resolve(path.dirname(info.file), relative)
      : undefined;
  };
  for (const node of info.nodes) {
    if (node.type === "CallExpression") {
      const method = apiMethod(node);
      if (
        method === "<dynamic>" ||
        (method === undefined &&
          node.callee.type === "MemberExpression" &&
          node.callee.computed &&
          node.callee.object.type === "Identifier" &&
          apis.has(node.callee.object.name))
      )
        violations.add("test mock APIs must have literal names");
      if (method === "mock" || method === "doMock") {
        const argument = node.arguments[0];
        const target =
          literal(argument) ??
          (argument?.type === "Identifier"
            ? constants.get(argument.name)
            : argument?.type === "ImportExpression"
              ? literal(argument.source)
              : undefined);
        const factory = unwrap(node.arguments[1]);
        const spy = objectProperties(factory);
        const flag = spy?.get("spy");
        const observes =
          spy?.size === 1 && flag?.type === "Literal" && flag.value === true;
        if (
          target === undefined ||
          !(
            observes ||
            (protectedImport(target) &&
              transparentFactory(factory, unchangedObservation)) ||
            platformFactory(target, factory)
          )
        )
          violations.add(
            "tests keep modules real; only unchanged observation or an approved API/context platform seam may register a mock",
          );
      }
      if (
        node.callee.type === "MemberExpression" &&
        modifications.test(member(node.callee)) &&
        (rootOwn(node.callee.object) || ownSpy(node.callee.object))
      )
        violations.add(
          "tests cannot replace own or SDK behavior through a spy or mocked view",
        );
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        ["Object", "Reflect"].includes(node.callee.object.name) &&
        ["assign", "defineProperty", "set"].includes(member(node.callee)) &&
        rootOwn(node.arguments[0])
      )
        violations.add("tests cannot overwrite imported own or SDK members");
      const resolved =
        /^(?:test\/|\.storybook\/)|\.stories\.[cm]?[jt]sx?$/u.test(sourcePath)
          ? calledBinding(info, node.callee)
          : undefined;
      if (
        resolved &&
        /[/\\](?:src|app)[/\\]/u.test(resolved.module.file) &&
        [
          "FunctionDeclaration",
          "FunctionExpression",
          "ArrowFunctionExpression",
        ].includes(resolved.node.type) &&
        "params" in resolved.node
      )
        for (const [index, parameter] of resolved.node.params.entries()) {
          const provided = node.arguments[index];
          if (
            parameter.type !== "AssignmentPattern" ||
            !provided ||
            (provided.type === "Identifier" && provided.name === "undefined") ||
            !callableDefault(resolved.module, parameter.right)
          )
            continue;
          const actual =
            provided.type === "Identifier"
              ? binding(info, provided.name)
              : undefined;
          const expected =
            parameter.right.type === "Identifier"
              ? binding(resolved.module, parameter.right.name)
              : undefined;
          if (
            !actual ||
            !expected ||
            actual.module.file !== expected.module.file ||
            actual.node !== expected.node
          )
            violations.add(
              "tests exercise own callable defaults instead of supplying a replacement",
            );
        }
    }
    if (node.type === "AssignmentExpression" && rootOwn(node.left)) {
      if (
        node.left.type === "MemberExpression" ||
        (node.left.type === "Identifier" && callableDefault(info, node.left))
      )
        violations.add("tests cannot overwrite imported own or SDK members");
    }
    if (
      node.type === "Property" &&
      name(node.key) === "alias" &&
      info.nodes.some(
        (parent) =>
          parent.type === "Property" &&
          name(parent.key) === "resolve" &&
          parent.value.type === "ObjectExpression" &&
          parent.value.properties.some((property) => property === node),
      )
    ) {
      const aliases = objectProperties(unwrap(node.value));
      if (!aliases)
        violations.add("test aliases declare literal targets and adapters");
      for (const [key, value] of aliases ?? []) {
        if (key === "@" || own(key)) {
          if (
            key !== "@" ||
            configuredPath(value) !== path.resolve(webRoot, "src")
          )
            violations.add("test aliases cannot redirect own modules");
        } else {
          const target = frameworkAliasContexts.get(sourcePath)?.get(key);
          if (
            target === undefined ||
            configuredPath(value) !== path.resolve(webRoot, target)
          )
            violations.add(
              "framework aliases require the approved target, adapter and owning context",
            );
        }
      }
    }
  }
  return [...violations].map((message) => `${sourcePath}: ${message}`);
}
