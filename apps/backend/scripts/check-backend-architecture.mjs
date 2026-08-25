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

const tableReferenceMethods = new Set([
  "deleteFrom",
  "fullJoin",
  "innerJoin",
  "insertInto",
  "leftJoin",
  "rightJoin",
  "selectFrom",
  "updateTable",
]);

const sqlTableReference = new RegExp(
  String.raw`\b(?:from|join|update|into)\s+((?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*)(?:\s*\.\s*(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*))?)`,
  "giu",
);

function normalizeSqlIdentifier(identifier) {
  return identifier.replaceAll('"', "").replaceAll(/\s/gu, "");
}

function referencesFromSql(sqlText) {
  return [...sqlText.matchAll(sqlTableReference)].flatMap((match) =>
    match[1] === undefined ? [] : [normalizeSqlIdentifier(match[1])],
  );
}

function staticString(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function databaseTableReferences(sourceFile) {
  const references = [];
  const unresolved = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      tableReferenceMethods.has(node.expression.name.text) &&
      node.arguments.length > 0
    ) {
      const table = staticString(node.arguments[0]);
      if (table === undefined) {
        unresolved.push(node.expression.name.text);
      } else {
        references.push(table.split(/\s+/u)[0]);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.getText(sourceFile) === "sql.raw"
    ) {
      const rawSql = node.arguments[0] === undefined
        ? undefined
        : staticString(node.arguments[0]);
      if (rawSql === undefined) {
        unresolved.push("sql.raw");
      } else {
        references.push(...referencesFromSql(rawSql));
      }
    }
    if (
      ts.isTaggedTemplateExpression(node) &&
      node.tag.getText(sourceFile).startsWith("sql")
    ) {
      const sqlText = node.template.getText(sourceFile);
      references.push(...referencesFromSql(sqlText));
      if (/\b(?:from|join|update|into)\s+\$\{/iu.test(sqlText)) {
        unresolved.push("sql template table identifier");
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { references, unresolved };
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

function owningSchema(moduleName) {
  return moduleName.replaceAll("-", "_");
}

function isApprovedPersistenceImport(file, specifier) {
  return (
    file.startsWith("src/infrastructure/postgres/") ||
    /^src\/modules\/[^/]+\/infrastructure\/postgres\//.test(file) ||
    file.startsWith("src/migrations/") ||
    // The shared readiness service owns the single cross-runtime database probe.
    (file === "src/infrastructure/operational-readiness.ts" &&
      specifier === "kysely")
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
  if (importsRawPersistence && !isApprovedPersistenceImport(sourcePath, specifier)) {
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

function databaseReferenceViolations(sourceFile) {
  const sourcePath = scannedPath(sourceFile.fileName);
  const sourceModule = owningModule(sourcePath);
  if (sourcePath.includes("/infrastructure/postgres/migrations/")) {
    return [];
  }
  const { references, unresolved } = databaseTableReferences(sourceFile);
  const expectedSchema = sourceModule === undefined
    ? sourcePath === "src/development/seed-local-development.ts"
      ? "materials"
      : undefined
    : owningSchema(sourceModule);
  const violations = unresolved.map(
    (operation) =>
      `${sourcePath}: database table references must use statically declared identifiers (${operation})`,
  );
  return [...violations, ...references.flatMap((reference) => {
    if (expectedSchema === undefined) {
      return [
        `${sourcePath}: application schema references must stay inside the owning Module (${reference})`,
      ];
    }
    const separator = reference.indexOf(".");
    if (separator === -1) {
      return [
        `${sourcePath}: database table references must be schema-qualified (${reference})`,
      ];
    }
    const schema = reference.slice(0, separator);
    return schema === expectedSchema
      ? []
      : [
          `${sourcePath}: database table references must stay inside the owning Module schema (${reference})`,
        ];
  })];
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
  return [
    ...moduleSpecifiers(sourceFile).flatMap((specifier) =>
      violationsFor(source, specifier).map(
        (message) => `${scannedPath(source)}: ${message} (${specifier})`,
      ),
    ),
    ...databaseReferenceViolations(sourceFile),
  ];
});

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Backend architecture imports passed.\n");
}
