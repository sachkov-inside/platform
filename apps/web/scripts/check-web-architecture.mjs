import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { parseSync, Visitor } from "oxc-parser";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const requestedRoots = process.argv.slice(2);
const scanRoots = (requestedRoots.length === 0 ? ["src", "app"] : requestedRoots).map(
  (root) => path.resolve(webRoot, root),
);
const backendOperationPaths = new Set(
  Object.keys(
    JSON.parse(
      readFileSync(
        path.resolve(webRoot, "../backend/openapi/platform-api.json"),
        "utf8",
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

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:cts|mts|ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

function scannedPath(file) {
  return path.relative(webRoot, file).split(path.sep).join("/");
}

function moduleSpecifiers(program) {
  const specifiers = [];
  new Visitor({
    ImportDeclaration(node) {
      if (typeof node.source.value === "string") specifiers.push(node.source.value);
    },
    ExportAllDeclaration(node) {
      if (typeof node.source.value === "string") specifiers.push(node.source.value);
    },
    ExportNamedDeclaration(node) {
      if (typeof node.source?.value === "string") specifiers.push(node.source.value);
    },
  }).visit(program);
  return specifiers;
}

function stringLiterals(program) {
  const values = [];
  new Visitor({
    Literal(node) {
      if (typeof node.value === "string") values.push(node.value);
    },
    TemplateLiteral(node) {
      if (node.expressions.length === 0) {
        values.push(node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "");
      }
    },
  }).visit(program);
  return values;
}

function hasUseClientDirective(program) {
  for (const statement of program.body) {
    if (statement.type === "ExpressionStatement" && statement.directive !== null) {
      if (statement.directive === "use client") return true;
      continue;
    }
    break;
  }
  return false;
}

function hasDirective(program, directive) {
  return program.body.some(
    (statement) =>
      statement.type === "ExpressionStatement" &&
      statement.directive === directive,
  );
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

function moduleLayer(file) {
  const segments = scannedPath(file).split("/");
  const sourceIndex = segments.lastIndexOf("src");
  const appIndex = segments.lastIndexOf("app");
  const layerIndex = sourceIndex >= 0 ? sourceIndex + 1 : appIndex;
  const layer = segments[layerIndex];
  if (!layerRanks.has(layer)) return undefined;
  const rawSlice = segments[layerIndex + 1] ?? "";
  return {
    layer,
    rank: layerRanks.get(layer),
    slice: rawSlice.split(".")[0] ?? rawSlice,
  };
}

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

function readsBackendEndpointEnvironment(program) {
  return readsProcessEnvironment(program, isBackendEndpointName);
}

function readsRuntimeConfigurationEnvironment(program) {
  return readsProcessEnvironment(program, (name) =>
    runtimeConfigurationNames.has(name),
  );
}

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

function isBackendEndpointName(name) {
  return (
    name === "BACKEND_BASE_URL" ||
    /NEXT_PUBLIC.*(?:BACKEND|NEST)|(?:BACKEND|NEST).*(?:URL|ORIGIN)/iu.test(
      name,
    )
  );
}

function callsNestOperationByAbsoluteUrl(program) {
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

function callsSameOriginMutationDynamically(program) {
  const directBindings = new Set();
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
        (specifier.imported.name ?? specifier.imported.value) ===
          "requestSameOriginMutation"
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
        node.callee.type === "Identifier" && directBindings.has(node.callee.name);
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

function resolveAbsoluteFetchArgument(argument, absoluteStringBindings) {
  const literal = literalString(argument);
  if (literal !== undefined && /^https?:\/\//u.test(literal)) {
    return literal;
  }
  if (argument.type === "Identifier") {
    return absoluteStringBindings.get(argument.name);
  }
  if (argument.type !== "TemplateLiteral") return undefined;

  let value = argument.quasis[0]?.value.cooked ?? argument.quasis[0]?.value.raw ?? "";
  for (const [index, expression] of argument.expressions.entries()) {
    if (expression.type !== "Identifier") return undefined;
    const binding = absoluteStringBindings.get(expression.name);
    if (binding === undefined) return undefined;
    const quasi = argument.quasis[index + 1];
    value += binding + (quasi?.value.cooked ?? quasi?.value.raw ?? "");
  }
  return /^https?:\/\//u.test(value) ? value : undefined;
}

function literalString(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "";
  }
  return undefined;
}

function memberPropertyName(node) {
  if (node?.type !== "MemberExpression") return "";
  if (node.property.type === "Identifier") return node.property.name;
  return typeof node.property.value === "string" ? node.property.value : "";
}

function isNestOperationUrl(value) {
  if (value === undefined) return false;
  try {
    const pathname = new URL(value).pathname;
    return backendOperationPathPatterns.some((pattern) => pattern.test(pathname));
  } catch {
    return false;
  }
}

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
    ...[".ts", ".tsx", ".mts", ".cts"].map((extension) => `${base}${extension}`),
    ...[".ts", ".tsx", ".mts", ".cts"].map((extension) =>
      path.join(base, `index${extension}`),
    ),
  ]) {
    if (knownFiles.has(candidate)) return candidate;
  }
  return undefined;
}

for (const scanRoot of scanRoots) {
  if (!existsSync(scanRoot) || !statSync(scanRoot).isDirectory()) {
    throw new TypeError(`Architecture scan root is not a directory: ${scanRoot}`);
  }
}

const parsedFiles = new Map(
  [...new Set(scanRoots.flatMap(sourceFiles))].map((file) => {
    const { errors, program } = parseSync(file, readFileSync(file, "utf8"));
    if (errors.length > 0) {
      throw new SyntaxError(`Oxc could not parse ${file}: ${errors[0].message}`);
    }
    return [file, program];
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
  const insideBackendTransport = sourcePath.startsWith("src/shared/api/backend/");
  const insideRuntimeConfiguration =
    sourcePath === "src/shared/config/runtime-config.server.ts";
  const insideApplicationRouting =
    sourcePath.startsWith("src/shared/routing/") ||
    sourcePath.startsWith("src/widgets/authoring-shell/");
  const isBrowserCode = browserFiles.has(file);
  const specifiers = moduleSpecifiers(program);
  const findingsForFile = specifiers.flatMap((specifier) => {
    const dependency = resolveLocalModule(file, specifier, parsedFiles);
    const boundaryFinding =
      dependency === undefined ? undefined : layerFinding(file, dependency);
    if (boundaryFinding !== undefined) return [boundaryFinding];
    if (!insideBackendTransport && specifier === "openapi-typescript-codegen") {
      return [`${sourcePath}: codegen runtime belongs to the backend transport module`];
    }
    if (!insideBackendTransport && specifier.includes("shared/api/backend/generated")) {
      return [`${sourcePath}: generated API types belong to the backend transport module`];
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
  [
    "app/authoring/materials/page.tsx",
    "app/authoring/playlists/page.tsx",
    "app/authoring/playlists/[seriesId]/page.tsx",
  ].some((suffix) => scannedPath(file).endsWith(suffix)),
)) {
  const visited = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const program = parsedFiles.get(file);
    if (program === undefined) continue;
    for (const specifier of moduleSpecifiers(program)) {
      if (specifier.startsWith("@tiptap/")) {
        findings.push(
          `${scannedPath(entry)}: lightweight authoring routes cannot reach the Tiptap editor bundle (via ${scannedPath(file)})`,
        );
      }
      const dependency = resolveLocalModule(file, specifier, parsedFiles);
      if (dependency !== undefined) pending.push(dependency);
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Web transport architecture passed.\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
