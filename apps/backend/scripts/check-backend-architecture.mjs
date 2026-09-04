import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";

import { parseSync, Visitor } from "oxc-parser";

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
    ImportExpression(node) {
      if (node.source.type === "Literal" && typeof node.source.value === "string") {
        specifiers.push(node.source.value);
      }
    },
  }).visit(program);
  return specifiers;
}

const sqlTableReference = new RegExp(
  String.raw`(?:\bfrom|\bjoin|(?<!\bfor\s)\bupdate|\binto)\s+((?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*)(?:\s*\.\s*(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*))?)`,
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

function databaseTableReferences(program) {
  const references = [];
  const unresolved = [];
  new Visitor({
    CallExpression(node) {
      if (isMember(node.callee, "Prisma", "raw")) {
        unresolved.push("Prisma.raw");
      }
      const operation = memberPropertyName(node.callee);
      if (["$executeRawUnsafe", "$queryRawUnsafe"].includes(operation)) {
        unresolved.push(operation);
      }
    },
    TaggedTemplateExpression(node) {
      if (isMember(node.tag, "Prisma", "sql")) {
        const sqlText = node.quasi.quasis
          .map((quasi) => quasi.value.raw)
          .join("${}");
      references.push(...referencesFromSql(sqlText));
      if (
        /(?:\bfrom|\bjoin|(?<!\bfor\s)\bupdate|\binto)\s+\$\{/iu.test(
          sqlText,
        )
      ) {
        unresolved.push("sql template table identifier");
      }
      }
    },
  }).visit(program);
  return { references, unresolved };
}

function isMember(node, objectName, propertyName) {
  return (
    node?.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === objectName &&
    memberPropertyName(node) === propertyName
  );
}

function memberPropertyName(node) {
  if (node?.type !== "MemberExpression") return "";
  if (node.property.type === "Identifier") return node.property.name;
  return typeof node.property.value === "string" ? node.property.value : "";
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

function isNestAdapter(file) {
  return (
    file.includes("/adapters/nest/") ||
    /\.(?:controller|filter|module)\.[cm]?ts$/u.test(file)
  );
}

function violationsFor(source, specifier) {
  const sourcePath = scannedPath(source);
  const importedPath = importedRepositoryPath(sourcePath, specifier);
  const violations = [];
  const sourceModule = owningModule(sourcePath);
  const importedModule = importedPath === undefined ? undefined : owningModule(importedPath);

  const importsCapabilityImplementation =
    importedModule !== undefined &&
    sourceModule !== importedModule &&
    !/^src\/modules\/[^/]+\/index\.[cm]?[jt]s$/u.test(importedPath);
  const importsFrozenMigration =
    importedPath?.includes("/infrastructure/postgres/migrations/") === true;
  if (
    importsCapabilityImplementation &&
    !(sourcePath.startsWith("src/migrations/") && importsFrozenMigration)
  ) {
    violations.push(
      `callers must import the ${importedModule} capability index.ts`,
    );
  }

  if (
    importedPath !== undefined &&
    /^src\/modules\/[^/]+\/internal\//.test(importedPath) &&
    sourceModule !== importedModule
  ) {
    violations.push("a capability internal module was imported from outside its owner");
  }

  const importsKysely = specifier === "kysely" || specifier.startsWith("kysely/");
  if (importsKysely) {
    violations.push("Kysely is forbidden; Prisma is the only application ORM");
  }

  const importsPrismaPackage =
    specifier === "@prisma/client" ||
    specifier.startsWith("@prisma/client/") ||
    specifier.startsWith("@prisma/adapter-");
  const importsPg = specifier === "pg" || specifier.startsWith("pg/");
  const ownsPostgresLifecycle = [
    "src/infrastructure/postgres/migrate-to-latest.ts",
    "src/infrastructure/worker-healthcheck.ts",
    "src/infrastructure/worker-runtime.ts",
  ].includes(sourcePath);
  const importsDeletedGeneratedPersistence =
    importedPath?.includes("/infrastructure/postgres/generated/") === true;
  if (
    (importsPrismaPackage && !sourcePath.startsWith("src/infrastructure/prisma/")) ||
    (importsPg && !ownsPostgresLifecycle) ||
    importsDeletedGeneratedPersistence
  ) {
    violations.push("raw persistence imports require an approved postgres owner path");
  }

  if (
    sourceModule !== undefined &&
    !isNestAdapter(sourcePath) &&
    specifier.startsWith("@nestjs/")
  ) {
    violations.push("capability implementation cannot import Nest adapters");
  }

  return violations;
}

function databaseReferenceViolations(sourceFile, program) {
  const sourcePath = scannedPath(sourceFile);
  const sourceModule = owningModule(sourcePath);
  if (sourcePath.includes("/infrastructure/postgres/migrations/")) {
    return [];
  }
  const { references, unresolved } = databaseTableReferences(program);
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
    if (
      sourcePath === "src/infrastructure/operational-readiness.ts" &&
      reference === "public.platform_migrations"
    ) {
      return [];
    }
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
  const { errors, program } = parseSync(source, readFileSync(source, "utf8"));
  if (errors.length > 0) {
    throw new SyntaxError(`Oxc could not parse ${source}: ${errors[0].message}`);
  }
  return [
    ...moduleSpecifiers(program).flatMap((specifier) =>
      violationsFor(source, specifier).map(
        (message) => `${scannedPath(source)}: ${message} (${specifier})`,
      ),
    ),
    ...databaseReferenceViolations(source, program),
  ];
});

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Backend architecture imports passed.\n");
}
