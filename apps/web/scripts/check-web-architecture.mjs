import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import ts from "typescript";

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

function moduleSpecifiers(sourceFile) {
  const specifiers = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

function stringLiterals(sourceFile) {
  const values = [];
  function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      values.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return values;
}

function hasUseClientDirective(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isStringLiteral(statement.expression)
    ) {
      if (statement.expression.text === "use client") return true;
      continue;
    }
    break;
  }
  return false;
}

function readsBackendEndpointEnvironment(sourceFile) {
  let found = false;
  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "env" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "process" &&
      isBackendEndpointName(node.name.text)
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
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

function callsNestOperationByAbsoluteUrl(sourceFile) {
  const absoluteStringBindings = new Map();
  let found = false;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer)) &&
      /^https?:\/\//u.test(node.initializer.text)
    ) {
      absoluteStringBindings.set(node.name.text, node.initializer.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch" &&
      node.arguments[0] !== undefined &&
      isNestOperationUrl(
        resolveAbsoluteFetchArgument(node.arguments[0], absoluteStringBindings),
      )
    ) {
      found = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function resolveAbsoluteFetchArgument(argument, absoluteStringBindings) {
  if (
    (ts.isStringLiteral(argument) ||
      ts.isNoSubstitutionTemplateLiteral(argument)) &&
    /^https?:\/\//u.test(argument.text)
  ) {
    return argument.text;
  }
  if (ts.isIdentifier(argument)) {
    return absoluteStringBindings.get(argument.text);
  }
  if (!ts.isTemplateExpression(argument)) return undefined;

  let value = argument.head.text;
  for (const { expression, literal } of argument.templateSpans) {
    if (!ts.isIdentifier(expression)) return undefined;
    const binding = absoluteStringBindings.get(expression.text);
    if (binding === undefined) return undefined;
    value += binding + literal.text;
  }
  return /^https?:\/\//u.test(value) ? value : undefined;
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
  [...new Set(scanRoots.flatMap(sourceFiles))].map((file) => [
    file,
    ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      false,
    ),
  ]),
);
const browserFiles = new Set(
  [...parsedFiles].flatMap(([file, sourceFile]) =>
    /\.client\.[cm]?[jt]sx?$/.test(file) || hasUseClientDirective(sourceFile)
      ? [file]
      : [],
  ),
);
const pendingBrowserFiles = [...browserFiles];
while (pendingBrowserFiles.length > 0) {
  const file = pendingBrowserFiles.pop();
  const sourceFile = parsedFiles.get(file);
  if (sourceFile === undefined) continue;
  for (const specifier of moduleSpecifiers(sourceFile)) {
    const dependency = resolveLocalModule(file, specifier, parsedFiles);
    if (dependency !== undefined && !browserFiles.has(dependency)) {
      browserFiles.add(dependency);
      pendingBrowserFiles.push(dependency);
    }
  }
}

const findings = [...parsedFiles].flatMap(([file, sourceFile]) => {
  const sourcePath = scannedPath(file);
  const insideBackendTransport = sourcePath.startsWith("src/shared/api/backend/");
  const isBrowserCode = browserFiles.has(file);
  const specifiers = moduleSpecifiers(sourceFile);
  const findingsForFile = specifiers.flatMap((specifier) => {
    if (!insideBackendTransport && specifier === "openapi-fetch") {
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
    stringLiterals(sourceFile).some((value) => backendOperationPaths.has(value))
  ) {
    findingsForFile.push(
      `${sourcePath}: manual Nest operation paths belong to the backend transport module`,
    );
  }
  if (isBrowserCode && readsBackendEndpointEnvironment(sourceFile)) {
    findingsForFile.push(
      `${sourcePath}: browser code cannot address Nest directly; use a same-origin BFF route`,
    );
  }
  if (isBrowserCode && callsNestOperationByAbsoluteUrl(sourceFile)) {
    findingsForFile.push(
      `${sourcePath}: browser code cannot call a Nest operation by absolute URL; use a same-origin BFF route`,
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
