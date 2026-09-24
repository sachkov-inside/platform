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

  if (specifier.startsWith("@tiptap/")) {
    violations.push(
      "material document blocks belong to the shared block registry; import the document schema from @inside/material-blocks",
    );
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
      ["public.platform_migrations", "pgboss.version"].includes(reference)
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

const advisoryLockCall = /pg_(?:try_)?advisory_/iu;
const advisoryLockOwners = [
  // The single source of transaction lock keys: operations exclude each other only through it.
  "src/infrastructure/prisma/transaction-locks.ts",
  // Process lifecycle over a dedicated pg session, not capability data access.
  "src/infrastructure/postgres/migrate-to-latest.ts",
  "src/infrastructure/worker-runtime.ts",
];
// Locks other Modules still write in place. platform#696 moves them and removes this list.
const legacyAdvisoryLockFiles = [
  "src/modules/accounts/infrastructure/postgres/advisory-locks.ts",
  "src/modules/billing/infrastructure/postgres/catalog-lock.ts",
  "src/modules/member-profiles/features/change-profile-avatar/change-profile-avatar.ts",
  "src/modules/member-profiles/features/cleanup-profile-avatar-orphans/cleanup-profile-avatar-orphans.ts",
  "src/modules/membership-entitlements/infrastructure/access-lock.ts",
  "src/modules/notifications/features/accept-transport-message/accept-transport-message.ts",
  "src/modules/notifications/infrastructure/locks.ts",
  "src/modules/reading-activity/features/set-reading-state/reading-locks.ts",
  "src/modules/telegram-membership/facets/telegram-membership/assemble-telegram-membership.ts",
  "src/modules/telegram-membership/features/complete-telegram-sign-in/telegram-account-sign-in.ts",
  "src/modules/telegram-membership/infrastructure/community-lock.ts",
];

function writesAdvisoryLock(program) {
  let found = false;
  new Visitor({
    Literal(node) {
      if (typeof node.value === "string" && advisoryLockCall.test(node.value)) found = true;
    },
    TemplateLiteral(node) {
      if (node.quasis.some((quasi) => advisoryLockCall.test(quasi.value.raw))) found = true;
    },
  }).visit(program);
  return found;
}

function advisoryLockViolations(sourceFile, program) {
  const sourcePath = scannedPath(sourceFile);
  if (
    sourcePath.includes("/infrastructure/postgres/migrations/") ||
    advisoryLockOwners.includes(sourcePath)
  ) {
    return [];
  }
  const writesLock = writesAdvisoryLock(program);
  if (legacyAdvisoryLockFiles.includes(sourcePath)) {
    return writesLock
      ? []
      : [`${sourcePath}: no longer writes an advisory lock; remove it from legacyAdvisoryLockFiles`];
  }
  return writesLock
    ? [`${sourcePath}: advisory lock keys come from src/infrastructure/prisma/transaction-locks.ts`]
    : [];
}

// Delegates a Module's capability type lists only to hand its transaction to their owner. Keep in
// step with the foreign delegates of that type in src/infrastructure/prisma/prisma-client.ts.
const handoffDelegates = new Map([
  ["materials", ["materialAsset", "video", "videoDeletionOperation"]],
]);

function handoffDelegateViolations(sourceFile, program) {
  const sourcePath = scannedPath(sourceFile);
  const delegates = handoffDelegates.get(owningModule(sourcePath) ?? "");
  if (delegates === undefined) return [];
  const used = new Set();
  new Visitor({
    MemberExpression(node) {
      const delegate = memberPropertyName(node.object);
      if (delegates.includes(delegate)) used.add(delegate);
    },
  }).visit(program);
  return [...used].map(
    (delegate) =>
      `${sourcePath}: ${delegate} belongs to another Module; pass the transaction to its owner's function (${delegate})`,
  );
}

// Сбой зависимости в Module записывается с причиной: catch передаёт пойманное значение
// reporter из src/infrastructure/observability (dependencyFailure, reportDependencyFailure,
// describeError), каналу наблюдений уведомлений (loggableFailure), делает причиной новой ошибки
// или бросает дальше. Отказ
// разбора чужого ввода — не сбой зависимости; такой catch объясняет себя первой строкой тела.
const inputRejectionMarker = "Not a dependency failure:";
const reportsFailure = /\b(?:dependencyFailure|reportDependencyFailure|describeError|loggableFailure)\(|\bthrow\b/u;

function swallowedFailureViolations(sourceFile, sourceText, program, comments) {
  const sourcePath = scannedPath(sourceFile);
  if (owningModule(sourcePath) === undefined) return [];
  const violations = [];
  const lineOf = (offset) => sourceText.slice(0, offset).split("\n").length;
  // Метка засчитывается только первой строкой: между началом обработчика и его первым оператором.
  const explains = (from, body) => {
    const firstCode = body.type === "BlockStatement" ? (body.body[0]?.start ?? body.end) : body.start;
    return comments.some(
      (comment) =>
        comment.start > from &&
        comment.end <= firstCode &&
        comment.value.trim().startsWith(inputRejectionMarker),
    );
  };
  const wrapsCause = (body, param) =>
    param.type === "Identifier" &&
    new RegExp(`\\bnew\\s+\\w+\\([^;]*(?<![\\w$.])${param.name}(?![\\w$])`, "u").test(
      sourceText.slice(body.start, body.end),
    );
  const check = (kind, start, param, body) => {
    if (explains(start, body)) return;
    const advice = `report it with dependencyFailure or explain it with "// ${inputRejectionMarker}"`;
    if (param === null || param === undefined) {
      violations.push(`${sourcePath}:${lineOf(start)}: ${kind} swallows its failure; ${advice}`);
    } else if (!reportsFailure.test(sourceText.slice(body.start, body.end)) && !wrapsCause(body, param)) {
      const name = param.type === "Identifier" ? param.name : "its failure";
      violations.push(`${sourcePath}:${lineOf(start)}: ${kind} drops ${name} without reporting it; ${advice}`);
    }
  };
  new Visitor({
    // promise.catch(() => fallback) проглатывает причину так же, как пустой catch.
    CallExpression(node) {
      const handler = node.arguments[0];
      if (
        memberPropertyName(node.callee) === "catch" &&
        (handler?.type === "ArrowFunctionExpression" || handler?.type === "FunctionExpression")
      ) {
        check(".catch", node.start, handler.params[0], handler.body);
      }
    },
    CatchClause(node) {
      check("catch", node.start, node.param, node.body);
    },
  }).visit(program);
  return violations;
}

if (!statSync(scanRoot).isDirectory()) {
  throw new TypeError(`Architecture scan root is not a directory: ${scanRoot}`);
}


const findings = sourceFiles(scanRoot).flatMap((source) => {
  const sourceText = readFileSync(source, "utf8");
  const { comments, errors, program } = parseSync(source, sourceText);
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
    ...advisoryLockViolations(source, program),
    ...handoffDelegateViolations(source, program),
    ...swallowedFailureViolations(source, sourceText, program, comments),
  ];
});

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Backend architecture imports passed.\n");
}
