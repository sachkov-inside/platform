import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

import ts from "typescript";

const backendRoot = fileURLToPath(new URL("..", import.meta.url));
const scanRoot = path.resolve(backendRoot, process.argv[2] ?? "src");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(entryPath);
    }
    return /\.(?:cts|mts|ts)$/.test(entry.name) ? [entryPath] : [];
  });
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
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

function scannedPath(file) {
  const relative = path.relative(scanRoot, file).split(path.sep).join("/");
  return path.basename(scanRoot) === "src" ? `src/${relative}` : relative;
}

function importedRepositoryPath(sourcePath, specifier) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), specifier),
  );
}

function owningModule(file) {
  return /^src\/modules\/([^/]+)\//.exec(file)?.[1];
}

function isApprovedPersistenceOwner(file) {
  return (
    file.startsWith("src/infrastructure/postgres/") ||
    /^src\/modules\/[^/]+\/infrastructure\/postgres\//.test(file) ||
    file.startsWith("src/migrations/") ||
    // #61 will consolidate this existing adapter into the Platform database lifecycle.
    file === "src/modules/readiness/postgres-probe.ts"
  );
}

function violationsFor(source, specifier) {
  const sourcePath = scannedPath(source);
  const importedPath = importedRepositoryPath(sourcePath, specifier);
  const violations = [];
  const sourceModule = owningModule(sourcePath);
  const importedModule = importedPath === undefined ? undefined : owningModule(importedPath);

  const importsMaterialsImplementation =
    importedPath?.startsWith("src/modules/materials/") === true &&
    !/^src\/modules\/materials\/index\.[cm]?[jt]s$/.test(importedPath);
  const importsFrozenMaterialsMigration =
    importedPath?.startsWith(
      "src/modules/materials/infrastructure/postgres/migrations/",
    ) === true;
  if (
    importsMaterialsImplementation &&
    sourceModule !== "materials" &&
    !(sourcePath.startsWith("src/migrations/") && importsFrozenMaterialsMigration)
  ) {
    violations.push("callers must import the Materials capability index.ts");
  }

  if (
    importedPath !== undefined &&
    /^src\/modules\/[^/]+\/internal\//.test(importedPath) &&
    sourceModule !== importedModule
  ) {
    violations.push("a capability internal module was imported from outside its owner");
  }

  const importsRawPersistence =
    specifier === "kysely" ||
    specifier.startsWith("kysely/") ||
    specifier === "pg" ||
    specifier.startsWith("pg/") ||
    importedPath?.includes("/infrastructure/postgres/generated/") === true;
  if (importsRawPersistence && !isApprovedPersistenceOwner(sourcePath)) {
    violations.push("raw persistence imports require an approved postgres owner path");
  }

  if (
    /^src\/modules\/[^/]+\/(?:application|domain)\//.test(sourcePath) &&
    specifier.startsWith("@nestjs/")
  ) {
    violations.push("application and domain code cannot import Nest adapters");
  }

  return violations;
}

if (!statSync(scanRoot).isDirectory()) {
  throw new TypeError(`Architecture scan root is not a directory: ${scanRoot}`);
}

const findings = sourceFiles(scanRoot).flatMap((source) => {
  const sourceFile = ts.createSourceFile(
    source,
    readFileSync(source, "utf8"),
    ts.ScriptTarget.Latest,
    false,
  );
  return moduleSpecifiers(sourceFile).flatMap((specifier) =>
    violationsFor(source, specifier).map(
      (message) => `${scannedPath(source)}: ${message} (${specifier})`,
    ),
  );
});

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Backend architecture imports passed.\n");
}
