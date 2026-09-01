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

function readsBackendEndpointEnvironment(program) {
  let found = false;
  new Visitor({
    MemberExpression(node) {
      if (
        node.object.type === "MemberExpression" &&
        node.object.object.type === "Identifier" &&
        node.object.object.name === "process" &&
        memberPropertyName(node.object) === "env" &&
        isBackendEndpointName(memberPropertyName(node))
      ) {
        found = true;
      }
    },
  }).visit(program);
  return found;
}

function readsRuntimeConfigurationEnvironment(program) {
  let found = false;
  new Visitor({
    MemberExpression(node) {
      if (
        node.object.type === "MemberExpression" &&
        node.object.object.type === "Identifier" &&
        node.object.object.name === "process" &&
        memberPropertyName(node.object) === "env" &&
        runtimeConfigurationNames.has(memberPropertyName(node))
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
  const isBrowserCode = browserFiles.has(file);
  const specifiers = moduleSpecifiers(program);
  const findingsForFile = specifiers.flatMap((specifier) => {
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

  if (
    !insideBackendTransport &&
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

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Web transport architecture passed.\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
