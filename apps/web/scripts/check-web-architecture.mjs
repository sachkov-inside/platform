// @ts-check
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { z } from "zod";

import { parseSync, Visitor } from "oxc-parser";

/**
 * @typedef {import("oxc-parser").Program} Program
 * @typedef {import("oxc-parser").Statement} Statement
 * @typedef {import("oxc-parser").Function | import("oxc-parser").ArrowFunctionExpression} FunctionNode
 * @typedef {import("oxc-parser").Node} AstNode
 */

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const requestedRoots = process.argv.slice(2);
const scanRoots = (
  requestedRoots.length === 0 ? ["src", "app", "proxy.ts"] : requestedRoots
).map((root) => path.resolve(webRoot, root));
const backendOperationPaths = new Set(
  Object.keys(
    z
      .object({ paths: z.record(z.string(), z.unknown()) })
      .passthrough()
      .parse(
        JSON.parse(
          readFileSync(
            path.resolve(webRoot, "../backend/openapi/platform-api.json"),
            "utf8",
          ),
        ),
      ).paths,
  ),
);
const backendOperationPathPatterns = [...backendOperationPaths].map(
  (operationPath) =>
    new RegExp(
      `${operationPath
        .split(/(\{[^}]+\})/u)
        .map((part) =>
          /^\{[^}]+\}$/u.test(part) ? "[^/]+" : escapeRegExp(part),
        )
        .join("")}$`,
      "u",
    ),
);
/**
 * Kits that declare the material document block set. `@inside/material-blocks` owns them, so an
 * application that imports one is declaring blocks a second time.
 */
const documentBlockKitSpecifiers = new Set([
  "@tiptap/extension-table",
  "@tiptap/extension-unique-id",
  "@tiptap/starter-kit",
]);
/** Entry points that must stay free of the editor bundle. */
const editorFreeRouteEntries = [
  "app/(public)/(catalog)/materials/[slug]/page.tsx",
  "app/authoring/materials/page.tsx",
  "app/authoring/playlists/page.tsx",
  "app/authoring/playlists/[seriesId]/page.tsx",
];
const runtimeConfigurationNames = new Set([
  "BACKEND_BASE_URL",
  "LOGTO_ENDPOINT",
  "LOGTO_AUDIENCE",
  "LOGTO_APP_ID",
  "LOGTO_APP_SECRET",
  "LOGTO_COOKIE_SECRET",
  "NODE_ENV",
  "WEB_BASE_URL",
]);

/**
 * @param {string} root
 * @returns {string[]}
 */
function sourceFiles(root) {
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:cts|mts|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

/** @param {string} file */
function scannedPath(file) {
  return path.relative(webRoot, file).split(path.sep).join("/");
}

/** @param {Program} program */
function moduleSpecifiers(program) {
  /** @type {string[]} */
  const specifiers = [];
  new Visitor({
    ImportDeclaration(node) {
      if (typeof node.source.value === "string")
        specifiers.push(node.source.value);
    },
    ExportAllDeclaration(node) {
      if (typeof node.source.value === "string")
        specifiers.push(node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (typeof node.source?.value === "string")
        specifiers.push(node.source.value);
    },
  }).visit(program);
  return specifiers;
}

/** @param {Program} program */
function stringLiterals(program) {
  /** @type {string[]} */
  const values = [];
  new Visitor({
    Literal(node) {
      if (typeof node.value === "string") values.push(node.value);
    },
    TemplateLiteral(node) {
      if (node.expressions.length === 0) {
        values.push(
          node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "",
        );
      }
    },
  }).visit(program);
  return values;
}

/** @param {Program} program */
function hasUseClientDirective(program) {
  for (const statement of program.body) {
    if (
      statement.type === "ExpressionStatement" &&
      statement.directive !== null
    ) {
      if (statement.directive === "use client") return true;
      continue;
    }
    break;
  }
  return false;
}

/**
 * @param {Program} program
 * @param {string} directive
 */
function hasDirective(program, directive) {
  return program.body.some(
    (statement) =>
      statement.type === "ExpressionStatement" &&
      statement.directive === directive,
  );
}

/**
 * `"use cache"` и его варианты: `"use cache: private"`, `"use cache: remote"`.
 *
 * @param {Statement} statement
 * @returns {statement is import("oxc-parser").ExpressionStatement & { directive: string }}
 */
function isCacheDirective(statement) {
  return (
    statement.type === "ExpressionStatement" &&
    typeof statement.directive === "string" &&
    statement.directive.startsWith("use cache")
  );
}

/**
 * Кеш-директивы файла: на уровне модуля и внутри функций. Общий кеш держит только гостевое чтение
 * каталога (ADR 0027), поэтому искать приходится и во вложенных телах.
 *
 * @param {Program} program
 */
function cacheDirectives(program) {
  /** @type {string[]} */
  const directives = [];
  new Visitor({
    ExpressionStatement(node) {
      if (isCacheDirective(node)) directives.push(node.directive);
    },
  }).visit(program);
  return directives;
}

/**
 * Политика кеша принадлежит функции, а не файлу: у второго кешированного чтения в том же модуле без
 * неё не было бы ни тега, ни срока, и авторская запись его бы не сбросила.
 *
 * @param {Program} program
 */
function hasCachedReadWithoutPolicy(program) {
  let found = false;
  /** @param {FunctionNode} node */
  const check = (node) => {
    if (
      node.body?.type !== "BlockStatement" ||
      !node.body.body.some(isCacheDirective)
    )
      return;
    // The visitor walks a program's statements, so the function's own statements form one.
    if (
      !namesIdentifier(
        { ...program, body: node.body.body },
        "applyCatalogCachePolicy",
      )
    )
      found = true;
  };
  new Visitor({
    ArrowFunctionExpression: check,
    FunctionDeclaration: check,
    FunctionExpression: check,
  }).visit(program);
  return found;
}

/**
 * Именованный импорт под своим именем: переименованный или чужой одноимённый правило не выполняет.
 *
 * @param {Program} program
 * @param {string} source
 * @param {string} name
 */
function importsNamed(program, source, name) {
  return program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      statement.source.value === source &&
      statement.specifiers.some(
        (specifier) =>
          specifier.type === "ImportSpecifier" &&
          specifier.imported.type === "Identifier" &&
          specifier.imported.name === name &&
          specifier.local.name === name,
      ),
  );
}

/**
 * @param {Program} program
 * @param {string} name
 */
function namesIdentifier(program, name) {
  let seen = false;
  new Visitor({
    Identifier(node) {
      if (node.name === name) seen = true;
    },
  }).visit(program);
  return seen;
}

/** @param {string} specifier */
function importsTheSession(specifier) {
  return specifier.includes("shared/auth") || specifier === "next/headers";
}

/**
 * Модуль с кеш-директивой не должен видеть сессию: ни токена, ни cookie, ни модуля входа. Проверка
 * ловит прямое нарушение; токен под другим именем или сессия через посредника остаются делом
 * обзора — их не отличить от обычного кода по форме.
 *
 * @param {Program} program
 */
function seesTheSession(program) {
  return (
    namesIdentifier(program, "accessToken") ||
    moduleSpecifiers(program).some(importsTheSession)
  );
}

/**
 * `proxy` решает только по тому, что web знает сам (ADR 0027, «Настоящий 404 до начала ответа»).
 *
 * @param {string} specifier
 */
function reachesRequestTimeDependency(specifier) {
  return (
    importsTheSession(specifier) ||
    specifier.includes("shared/api/backend") ||
    specifier.startsWith("@logto/")
  );
}

/**
 * Сессия и сеть без импорта: обращение к `.cookies` и вызов `fetch`. Cookie из сырого заголовка
 * остаётся делом обзора — по форме это обычное чтение заголовка.
 *
 * @param {Program} program
 */
function readsCookiesOrFetches(program) {
  let found = false;
  new Visitor({
    MemberExpression(node) {
      if (memberPropertyName(node) === "cookies") found = true;
    },
    CallExpression(node) {
      const callee = node.callee;
      if (
        (callee.type === "Identifier" && callee.name === "fetch") ||
        (callee.type === "MemberExpression" &&
          memberPropertyName(callee) === "fetch")
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/**
 * Обходит модули, до которых дотягивается `entry`, и отдаёт каждый вместе с его программой.
 *
 * @param {string} entry
 */
function reachableModules(entry) {
  /** @type {Set<string>} */
  const visited = new Set();
  const pending = [entry];
  /** @type {{ file: string; program: Program }[]} */
  const reached = [];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const program = parsedFiles.get(file);
    if (program === undefined) continue;
    reached.push({ file, program });
    for (const specifier of moduleSpecifiers(program)) {
      const dependency = resolveLocalModule(file, specifier, parsedFiles);
      if (dependency !== undefined) pending.push(dependency);
    }
  }
  return reached;
}

/**
 * Статичные по замыслу `GET`-обработчики: их ответ не зависит ни от запроса, ни от среды. Тот же
 * перечень держит `check-prerendered-route-handlers.mjs`, который сверяет уже собранный манифест.
 */
const prerenderedRouteHandlers = ["app/(public)/social-card/route.tsx"];

/**
 * `GET`-обработчик, который не коснулся запроса до первого `return`, Next.js предсобирает при
 * сборке образа — без конфигурации и backend. Перехват исключений делает это незаметным: отказ от
 * предсборки приходит исключением, и `catch` выдаёт его за сбой зависимости, который застывает в
 * образе (ADR 0027). Поэтому обработчик объявлен в самом файле маршрута и начинается с
 * `await connection()`; переэкспорт допустим только из другого файла маршрута.
 *
 * @param {Program} program
 */
function getHandlerFinding(program) {
  for (const statement of program.body) {
    // `export *` может принести `GET` из модуля, который не начинает его с `connection()`.
    if (statement.type === "ExportAllDeclaration") return "declare";
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (
      declaration?.type === "FunctionDeclaration" &&
      declaration.id?.name === "GET"
    ) {
      const first = declaration.body?.body[0];
      const startsWithConnection =
        first?.type === "ExpressionStatement" &&
        first.expression.type === "AwaitExpression" &&
        first.expression.argument.type === "CallExpression" &&
        first.expression.argument.callee.type === "Identifier" &&
        first.expression.argument.callee.name === "connection";
      // Одноимённая функция из другого модуля правило не выполняет: нужна `connection` из Next.js.
      return startsWithConnection &&
        importsNamed(program, "next/server", "connection")
        ? undefined
        : "start";
    }
    if (
      declaration?.type === "VariableDeclaration" &&
      declaration.declarations.some(
        (entry) => entry.id.type === "Identifier" && entry.id.name === "GET",
      )
    ) {
      return "declare";
    }
    const exportsGet = statement.specifiers.some(
      (specifier) =>
        specifier.exported.type === "Identifier" &&
        specifier.exported.name === "GET",
    );
    if (exportsGet) {
      const source = statement.source?.value;
      return typeof source === "string" && /(?:^|\/)route$/u.test(source)
        ? undefined
        : "declare";
    }
  }
  return undefined;
}

const layerRanks = new Map([
  ["shared", 0],
  ["entities", 1],
  ["features", 2],
  ["widgets", 3],
  ["_pages", 4],
  ["_app", 5],
  ["app", 5],
]);

/** @param {string} file */
function moduleLayer(file) {
  const segments = scannedPath(file).split("/");
  const sourceIndex = segments.lastIndexOf("src");
  const appIndex = segments.lastIndexOf("app");
  const layerIndex = sourceIndex >= 0 ? sourceIndex + 1 : appIndex;
  const layer = segments[layerIndex];
  const rank = layer === undefined ? undefined : layerRanks.get(layer);
  if (layer === undefined || rank === undefined) return undefined;
  const rawSlice = segments[layerIndex + 1] ?? "";
  return {
    layer,
    rank,
    slice: rawSlice.split(".")[0] ?? rawSlice,
  };
}

/**
 * @param {string} importer
 * @param {string} dependency
 */
function layerFinding(importer, dependency) {
  const source = moduleLayer(importer);
  const target = moduleLayer(dependency);
  if (source === undefined || target === undefined) return undefined;
  if (target.rank > source.rank) {
    return `${scannedPath(importer)}: ${source.layer} cannot import the upper ${target.layer} layer`;
  }
  if (
    source.layer === target.layer &&
    ["_pages", "widgets", "features", "entities"].includes(source.layer) &&
    source.slice !== target.slice
  ) {
    return `${scannedPath(importer)}: ${source.layer} slices cannot import each other (${source.slice} -> ${target.slice})`;
  }
  return undefined;
}

/** @param {Program} program */
function declaresDocumentNode(program) {
  /** @type {Set<string>} */
  const nodeBindings = new Set();
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== "@tiptap/core"
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        exportedName(specifier.imported) === "Node"
      ) {
        nodeBindings.add(specifier.local.name);
      }
    }
  }

  let found = false;
  new Visitor({
    CallExpression(node) {
      if (
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        nodeBindings.has(node.callee.object.name) &&
        memberPropertyName(node.callee) === "create"
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/** @param {Program} program */
function readsPublicSiteOrigin(program) {
  let found = false;
  new Visitor({
    MemberExpression(node) {
      if (
        memberPropertyName(node) === "baseUrl" &&
        node.object.type === "MemberExpression" &&
        memberPropertyName(node.object) === "identity"
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/** @param {Program} program */
function readsBackendEndpointEnvironment(program) {
  return readsProcessEnvironment(program, isBackendEndpointName);
}

/** @param {Program} program */
function readsRuntimeConfigurationEnvironment(program) {
  return readsProcessEnvironment(program, (name) =>
    runtimeConfigurationNames.has(name),
  );
}

/**
 * @param {Program} program
 * @param {(name: string) => boolean} matchesName
 */
function readsProcessEnvironment(program, matchesName) {
  let found = false;
  new Visitor({
    MemberExpression(node) {
      if (
        node.object.type === "MemberExpression" &&
        node.object.object.type === "Identifier" &&
        node.object.object.name === "process" &&
        memberPropertyName(node.object) === "env" &&
        matchesName(memberPropertyName(node))
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/** @param {string} name */
function isBackendEndpointName(name) {
  return (
    name === "BACKEND_BASE_URL" ||
    /NEXT_PUBLIC.*(?:BACKEND|NEST)|(?:BACKEND|NEST).*(?:URL|ORIGIN)/iu.test(
      name,
    )
  );
}

/** @param {Program} program */
function callsNestOperationByAbsoluteUrl(program) {
  /** @type {Map<string, string>} */
  const absoluteStringBindings = new Map();
  let found = false;
  new Visitor({
    VariableDeclarator(node) {
      const value = literalString(node.init);
      if (
        node.id.type === "Identifier" &&
        value !== undefined &&
        /^https?:\/\//u.test(value)
      ) {
        absoluteStringBindings.set(node.id.name, value);
      }
    },
    CallExpression(node) {
      const argument = node.arguments[0];
      if (
        node.callee.type === "Identifier" &&
        node.callee.name === "fetch" &&
        argument !== undefined &&
        argument.type !== "SpreadElement" &&
        isNestOperationUrl(
          resolveAbsoluteFetchArgument(argument, absoluteStringBindings),
        )
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/** @param {Program} program */
function callsSameOriginMutationDynamically(program) {
  /** @type {Set<string>} */
  const directBindings = new Set();
  /** @type {Set<string>} */
  const namespaceBindings = new Set();
  for (const statement of program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== "@/shared/api/same-origin-mutation"
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        exportedName(specifier.imported) === "requestSameOriginMutation"
      ) {
        directBindings.add(specifier.local.name);
      }
      if (specifier.type === "ImportNamespaceSpecifier") {
        namespaceBindings.add(specifier.local.name);
      }
    }
  }

  let found = false;
  new Visitor({
    CallExpression(node) {
      const callsDirectBinding =
        node.callee.type === "Identifier" &&
        directBindings.has(node.callee.name);
      const callsNamespaceBinding =
        node.callee.type === "MemberExpression" &&
        node.callee.object.type === "Identifier" &&
        namespaceBindings.has(node.callee.object.name) &&
        memberPropertyName(node.callee) === "requestSameOriginMutation";
      if (!callsDirectBinding && !callsNamespaceBinding) return;
      const route = node.arguments[0];
      const method = node.arguments[1];
      if (
        route === undefined ||
        route.type === "SpreadElement" ||
        method === undefined ||
        method.type === "SpreadElement" ||
        literalString(route) === undefined ||
        literalString(method) === undefined
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

/**
 * @param {import("oxc-parser").Expression} argument
 * @param {Map<string, string>} absoluteStringBindings
 */
function resolveAbsoluteFetchArgument(argument, absoluteStringBindings) {
  const literal = literalString(argument);
  if (literal !== undefined && /^https?:\/\//u.test(literal)) {
    return literal;
  }
  if (argument.type === "Identifier") {
    return absoluteStringBindings.get(argument.name);
  }
  if (argument.type !== "TemplateLiteral") return undefined;

  let value =
    argument.quasis[0]?.value.cooked ?? argument.quasis[0]?.value.raw ?? "";
  for (const [index, expression] of argument.expressions.entries()) {
    if (expression.type !== "Identifier") return undefined;
    const binding = absoluteStringBindings.get(expression.name);
    if (binding === undefined) return undefined;
    const quasi = argument.quasis[index + 1];
    value += binding + (quasi?.value.cooked ?? quasi?.value.raw ?? "");
  }
  return /^https?:\/\//u.test(value) ? value : undefined;
}

/** @param {AstNode | null | undefined} node */
function literalString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "";
  }
  return undefined;
}

/** @param {AstNode | null | undefined} node */
function memberPropertyName(node) {
  if (node?.type !== "MemberExpression") return "";
  if (node.property.type === "Identifier") return node.property.name;
  return node.property.type === "Literal" &&
    typeof node.property.value === "string"
    ? node.property.value
    : "";
}

/**
 * The name an import or export specifier names, written as an identifier or a string.
 *
 * @param {import("oxc-parser").ModuleExportName} node
 */
function exportedName(node) {
  return "name" in node ? node.name : node.value;
}

/** @param {string | undefined} value */
function isNestOperationUrl(value) {
  if (value === undefined) return false;
  try {
    const pathname = new URL(value).pathname;
    return backendOperationPathPatterns.some((pattern) =>
      pattern.test(pathname),
    );
  } catch {
    return false;
  }
}

/**
 * @param {string} importer
 * @param {string} specifier
 * @param {ReadonlyMap<string, unknown>} knownFiles
 */
function resolveLocalModule(importer, specifier, knownFiles) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.resolve(webRoot, "src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(importer), specifier);
  } else {
    return undefined;
  }

  for (const candidate of [
    base,
    ...[".ts", ".tsx", ".mts", ".cts"].map(
      (extension) => `${base}${extension}`,
    ),
    ...[".ts", ".tsx", ".mts", ".cts"].map((extension) =>
      path.join(base, `index${extension}`),
    ),
  ]) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return undefined;
}

for (const scanRoot of scanRoots) {
  if (!existsSync(scanRoot)) {
    throw new TypeError(`Architecture scan root does not exist: ${scanRoot}`);
  }
}

const parsedFiles = new Map(
  [...new Set(scanRoots.flatMap(sourceFiles))].map((file) => {
    const { errors, program } = parseSync(file, readFileSync(file, "utf8"));
    const [firstError] = errors;
    if (firstError !== undefined) {
      throw new SyntaxError(
        `Oxc could not parse ${file}: ${firstError.message}`,
      );
    }
    return /** @type {const} */ ([file, program]);
  }),
);
const browserFiles = new Set(
  [...parsedFiles].flatMap(([file, program]) =>
    /\.client\.[cm]?[jt]sx?$/.test(file) || hasUseClientDirective(program)
      ? [file]
      : [],
  ),
);
const pendingBrowserFiles = [...browserFiles];
while (pendingBrowserFiles.length > 0) {
  const file = pendingBrowserFiles.pop();
  if (file === undefined) break;
  const program = parsedFiles.get(file);
  if (program === undefined) continue;
  for (const specifier of moduleSpecifiers(program)) {
    const dependency = resolveLocalModule(file, specifier, parsedFiles);
    if (dependency !== undefined && !browserFiles.has(dependency)) {
      browserFiles.add(dependency);
      pendingBrowserFiles.push(dependency);
    }
  }
}

const findings = [...parsedFiles].flatMap(([file, program]) => {
  const sourcePath = scannedPath(file);
  const insideBackendTransport = sourcePath.startsWith(
    "src/shared/api/backend/",
  );
  const insideRuntimeConfiguration =
    sourcePath === "src/shared/config/runtime-config.server.ts";
  const insideApplicationRouting =
    sourcePath.startsWith("src/shared/routing/") ||
    sourcePath.startsWith("src/widgets/authoring-shell/");
  const ownsPublicSiteOrigin =
    sourcePath.startsWith("src/shared/link-preview/") ||
    sourcePath.startsWith("src/shared/auth/");
  const isBrowserCode = browserFiles.has(file);
  const specifiers = moduleSpecifiers(program);
  const findingsForFile = specifiers.flatMap((specifier) => {
    const dependency = resolveLocalModule(file, specifier, parsedFiles);
    const boundaryFinding =
      dependency === undefined ? undefined : layerFinding(file, dependency);
    if (boundaryFinding !== undefined) return [boundaryFinding];
    if (documentBlockKitSpecifiers.has(specifier)) {
      return [
        `${sourcePath}: material document blocks belong to the shared block registry; import them from @inside/material-blocks`,
      ];
    }
    if (!insideBackendTransport && specifier === "openapi-typescript-codegen") {
      return [
        `${sourcePath}: codegen runtime belongs to the backend transport module`,
      ];
    }
    if (
      !insideBackendTransport &&
      specifier.includes("shared/api/backend/generated")
    ) {
      return [
        `${sourcePath}: generated API types belong to the backend transport module`,
      ];
    }
    if (
      isBrowserCode &&
      (specifier.includes("shared/api/backend/index.server") ||
        specifier.includes("shared/api/backend/generated"))
    ) {
      return [
        `${sourcePath}: browser code cannot import the direct Nest transport; use a same-origin BFF route`,
      ];
    }
    return [];
  });

  if (declaresDocumentNode(program)) {
    findingsForFile.push(
      `${sourcePath}: material document blocks belong to the shared block registry; add the block there instead of declaring a node here`,
    );
  }

  if (
    /(?:^|\/)app\/(?:.*\/)?route\.tsx?$/u.test(sourcePath) &&
    !prerenderedRouteHandlers.some((allowed) => sourcePath.endsWith(allowed))
  ) {
    const finding = getHandlerFinding(program);
    if (finding !== undefined) {
      findingsForFile.push(
        finding === "start"
          ? `${sourcePath}: a GET Route Handler starts with await connection(), or the build prerenders its answer`
          : `${sourcePath}: declare GET in the route file so that it starts with await connection()`,
      );
    }
  }

  const cached = cacheDirectives(program);
  if (cached.length > 0) {
    if (!sourcePath.endsWith(".public-cache.server.ts")) {
      findingsForFile.push(
        `${sourcePath}: "use cache" belongs to a *.public-cache.server.ts module that reads the catalog as a guest`,
      );
    }
    if (cached.some((directive) => directive !== "use cache")) {
      findingsForFile.push(
        `${sourcePath}: only the shared "use cache" is allowed; a per-session cache would carry protected content into prefetch`,
      );
    }
    // Директива на уровне модуля кеширует каждую его функцию и прячет их от проверки политики.
    if (program.body.some(isCacheDirective)) {
      findingsForFile.push(
        `${sourcePath}: declare "use cache" inside the function, not for the module, so that each cached read carries its own policy`,
      );
    }
    if (hasCachedReadWithoutPolicy(program)) {
      findingsForFile.push(
        `${sourcePath}: a cached catalog read sets its tag and lifetime through applyCatalogCachePolicy, or an authoring write cannot expire it`,
      );
    }
    if (seesTheSession(program)) {
      findingsForFile.push(
        `${sourcePath}: a cached catalog read cannot see the session; read it as a guest and keep the personal read uncached`,
      );
    }
  }

  if (
    moduleSpecifiers(program).includes("next/cache") &&
    namesIdentifier(program, "unstable_cache")
  ) {
    findingsForFile.push(
      `${sourcePath}: unstable_cache is a second shared cache outside the guest-read rule; use a *.public-cache.server.ts module`,
    );
  }

  if (hasDirective(program, "use server")) {
    findingsForFile.push(
      `${sourcePath}: Server Actions are not part of the client-owned mutation path; use TanStack Query and a same-origin Route Handler`,
    );
  }

  if (
    !insideBackendTransport &&
    !insideApplicationRouting &&
    stringLiterals(program).some((value) => backendOperationPaths.has(value))
  ) {
    findingsForFile.push(
      `${sourcePath}: manual Nest operation paths belong to the backend transport module`,
    );
  }
  if (isBrowserCode && readsBackendEndpointEnvironment(program)) {
    findingsForFile.push(
      `${sourcePath}: browser code cannot address Nest directly; use a same-origin BFF route`,
    );
  }
  if (isBrowserCode && callsNestOperationByAbsoluteUrl(program)) {
    findingsForFile.push(
      `${sourcePath}: browser code cannot call a Nest operation by absolute URL; use a same-origin BFF route`,
    );
  }
  if (callsSameOriginMutationDynamically(program)) {
    findingsForFile.push(
      `${sourcePath}: each browser mutation must declare a literal same-origin route and HTTP method`,
    );
  }
  if (
    !ownsPublicSiteOrigin &&
    !insideRuntimeConfiguration &&
    readsPublicSiteOrigin(program)
  ) {
    findingsForFile.push(
      `${sourcePath}: the public site origin belongs to the link preview module; read it there so it stays a request-time value`,
    );
  }
  if (
    !insideRuntimeConfiguration &&
    readsRuntimeConfigurationEnvironment(program)
  ) {
    findingsForFile.push(
      `${sourcePath}: application runtime environment belongs to the server-only config module`,
    );
  }
  return findingsForFile;
});

for (const entry of [...parsedFiles.keys()].filter((file) =>
  editorFreeRouteEntries.some((suffix) => scannedPath(file).endsWith(suffix)),
)) {
  for (const { file, program } of reachableModules(entry)) {
    for (const specifier of moduleSpecifiers(program)) {
      if (
        specifier.startsWith("@tiptap/") ||
        specifier === "@inside/material-blocks/schema"
      ) {
        findings.push(
          `${scannedPath(entry)}: reading and lightweight authoring routes cannot reach the Tiptap editor bundle (via ${scannedPath(file)})`,
        );
      }
    }
  }
}

for (const entry of [...parsedFiles.keys()].filter(
  (file) =>
    /^proxy\.[cm]?tsx?$/u.test(path.basename(file)) &&
    [webRoot, ...scanRoots]
      .map((root) => path.resolve(root))
      .includes(path.dirname(file)),
)) {
  for (const { file, program } of reachableModules(entry)) {
    if (
      moduleSpecifiers(program).some(reachesRequestTimeDependency) ||
      readsCookiesOrFetches(program)
    ) {
      findings.push(
        `${scannedPath(entry)}: proxy decides without a backend request; it cannot reach the backend or the session (via ${scannedPath(file)})`,
      );
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Web transport architecture passed.\n");
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
