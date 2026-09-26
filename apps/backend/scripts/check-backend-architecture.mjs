import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
    ImportExpression(node) {
      if (
        node.source.type === "Literal" &&
        typeof node.source.value === "string"
      ) {
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
          /(?:\bfrom|\bjoin|(?<!\bfor\s)\bupdate|\binto)\s+\$\{/iu.test(sqlText)
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
  const importedModule =
    importedPath === undefined ? undefined : owningModule(importedPath);

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
    sourceModule !== undefined &&
    capabilityIndexModule(importedPath) === sourceModule
  ) {
    violations.push(
      `the ${sourceModule} Module imports its own files directly, not through its index.ts`,
    );
  }

  if (
    importedPath !== undefined &&
    /^src\/modules\/[^/]+\/internal\//.test(importedPath) &&
    sourceModule !== importedModule
  ) {
    violations.push(
      "a capability internal module was imported from outside its owner",
    );
  }

  if (specifier.startsWith("@tiptap/")) {
    violations.push(
      "material document blocks belong to the shared block registry; import the document schema from @inside/material-blocks",
    );
  }

  const importsKysely =
    specifier === "kysely" || specifier.startsWith("kysely/");
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
    (importsPrismaPackage &&
      !sourcePath.startsWith("src/infrastructure/prisma/")) ||
    (importsPg && !ownsPostgresLifecycle) ||
    importsDeletedGeneratedPersistence
  ) {
    violations.push(
      "raw persistence imports require an approved postgres owner path",
    );
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
  const expectedSchema =
    sourceModule === undefined
      ? sourcePath === "src/development/seed-local-development.ts"
        ? "materials"
        : undefined
      : owningSchema(sourceModule);
  const violations = unresolved.map(
    (operation) =>
      `${sourcePath}: database table references must use statically declared identifiers (${operation})`,
  );
  return [
    ...violations,
    ...references.flatMap((reference) => {
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
    }),
  ];
}

const advisoryLockCall = /pg_(?:try_)?advisory_/iu;
const advisoryLockOwners = [
  // The single source of transaction lock keys: operations exclude each other only through it.
  "src/infrastructure/prisma/transaction-locks.ts",
  // Process lifecycle over a dedicated pg session, not capability data access.
  "src/infrastructure/postgres/migrate-to-latest.ts",
  "src/infrastructure/worker-runtime.ts",
];

function writesAdvisoryLock(program) {
  let found = false;
  new Visitor({
    Literal(node) {
      if (typeof node.value === "string" && advisoryLockCall.test(node.value))
        found = true;
    },
    TemplateLiteral(node) {
      if (node.quasis.some((quasi) => advisoryLockCall.test(quasi.value.raw)))
        found = true;
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
  return writesAdvisoryLock(program)
    ? [
        `${sourcePath}: advisory lock keys come from src/infrastructure/prisma/transaction-locks.ts`,
      ]
    : [];
}

// Delegates a Module's capability type lists only to hand its transaction to their owner. Keep in
// step with the foreign delegates of that type in src/infrastructure/prisma/prisma-client.ts or the
// Module's own infrastructure/prisma.ts.
const handoffDelegates = new Map([
  ["assets", ["material"]],
  [
    "materials",
    [
      "materialAsset",
      "video",
      "videoDeletionOperation",
      "workshopCaseMaterial",
    ],
  ],
  ["reading-activity", ["material", "publishedMaterialGuideMembership"]],
  ["videos", ["material", "publishedMaterial"]],
  [
    "workshop",
    [
      "accessChange",
      "accessGrant",
      "legacyClassification",
      "membershipBinding",
      "membershipEvidenceReceipt",
      "membershipProjection",
    ],
  ],
]);

// A delegate is used when one of its model operations is named; `candidate.material.materialId`
// is a field of an ordinary value, not the Materials delegate.
const prismaModelOperations = new Set([
  "aggregate",
  "count",
  "create",
  "createMany",
  "createManyAndReturn",
  "delete",
  "deleteMany",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);

function handoffDelegateViolations(sourceFile, program) {
  const sourcePath = scannedPath(sourceFile);
  const delegates = handoffDelegates.get(owningModule(sourcePath) ?? "");
  if (delegates === undefined) return [];
  const used = new Set();
  new Visitor({
    MemberExpression(node) {
      const delegate = memberPropertyName(node.object);
      if (
        delegates.includes(delegate) &&
        prismaModelOperations.has(memberPropertyName(node))
      ) {
        used.add(delegate);
      }
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
// или бросает дальше. Отказ разбора чужого ввода — не сбой зависимости; такой catch объясняет
// себя первой строкой тела.
const inputRejectionMarker = "Not a dependency failure:";
const reporters =
  "dependencyFailure|reportDependencyFailure|describeError|loggableFailure";

function swallowedFailureViolations(sourceFile, sourceText, program, comments) {
  const sourcePath = scannedPath(sourceFile);
  if (owningModule(sourcePath) === undefined) return [];
  const violations = [];
  const lineOf = (offset) => sourceText.slice(0, offset).split("\n").length;
  // Метка засчитывается только первой строкой: между началом обработчика и его первым оператором.
  const explains = (from, body) => {
    const firstCode =
      body.type === "BlockStatement"
        ? (body.body[0]?.start ?? body.end)
        : body.start;
    return comments.some(
      (comment) =>
        comment.start > from &&
        comment.end <= firstCode &&
        comment.value.trim().startsWith(inputRejectionMarker),
    );
  };
  // Текст обработчика без комментариев: упоминание reporter в комментарии ничего не записывает.
  const codeOf = (body) =>
    comments
      .filter(
        (comment) => comment.start >= body.start && comment.end <= body.end,
      )
      .reduceRight(
        (text, comment) =>
          text.slice(0, comment.start - body.start) +
          " ".repeat(comment.end - comment.start) +
          text.slice(comment.end - body.start),
        sourceText.slice(body.start, body.end),
      );
  // Пойманное значение уходит reporter, становится причиной новой ошибки или бросается дальше.
  // Условный throw засчитывается: так устроены обработчики гонок, где остальные ветки — ответы.
  const passesOn = (body, name) => {
    const caught = `(?<![\\w$.])${name}(?![\\w$])`;
    return [
      new RegExp(`\\b(?:${reporters})\\([^;]*${caught}`, "u"),
      new RegExp(`\\bnew\\s+\\w+\\([^;]*${caught}`, "u"),
      new RegExp(`\\bthrow\\s+${caught}`, "u"),
    ].some((pattern) => pattern.test(codeOf(body)));
  };
  const check = (kind, start, param, body) => {
    if (explains(start, body)) return;
    const advice = `report it with dependencyFailure or explain it with "// ${inputRejectionMarker}"`;
    if (param === null || param === undefined) {
      violations.push(
        `${sourcePath}:${lineOf(start)}: ${kind} swallows its failure; ${advice}`,
      );
    } else if (param.type !== "Identifier" || !passesOn(body, param.name)) {
      const name = param.type === "Identifier" ? param.name : "its failure";
      violations.push(
        `${sourcePath}:${lineOf(start)}: ${kind} drops ${name} without reporting it; ${advice}`,
      );
    }
  };
  new Visitor({
    // promise.catch(() => fallback) проглатывает причину так же, как пустой catch.
    CallExpression(node) {
      const handler = node.arguments[0];
      if (
        memberPropertyName(node.callee) === "catch" &&
        (handler?.type === "ArrowFunctionExpression" ||
          handler?.type === "FunctionExpression")
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

// A Module depends on another through any import of that Module: a value import, a type-only
// import, a re-export or a dynamic import(). The dependency graph stays acyclic, so a Module
// loads, composes and changes without the Modules that depend on it.
// A cycle diagnostic names the strongest import on each edge, the one to remove first.
const importKindRank = { type: 0, dynamic: 1, value: 2 };

function exportedName(node) {
  return node.type === "Identifier" ? node.name : String(node.value);
}

function declarationKind(node, kindField) {
  return node[kindField] === "type" ||
    (node.specifiers.length > 0 &&
      node.specifiers.every((specifier) => specifier[kindField] === "type"))
    ? "type"
    : "value";
}

// Every import of another file with the names it takes; "*" takes the whole interface.
function fileImports(program) {
  const imports = [];
  const destructured = new Map();
  new Visitor({
    ImportDeclaration(node) {
      imports.push({
        kind: declarationKind(node, "importKind"),
        names: node.specifiers.map((specifier) =>
          specifier.type === "ImportSpecifier"
            ? exportedName(specifier.imported)
            : specifier.type === "ImportDefaultSpecifier"
              ? "default"
              : "*",
        ),
        specifier: node.source.value,
      });
    },
    ExportAllDeclaration(node) {
      imports.push({
        kind: node.exportKind === "type" ? "type" : "value",
        names: ["*"],
        specifier: node.source.value,
      });
    },
    ExportNamedDeclaration(node) {
      if (typeof node.source?.value !== "string") return;
      imports.push({
        kind: declarationKind(node, "exportKind"),
        names: node.specifiers.map((specifier) =>
          exportedName(specifier.local),
        ),
        specifier: node.source.value,
      });
    },
    // const { Name } = await import("…") takes only the names it destructures.
    VariableDeclarator(node) {
      const imported =
        node.init?.type === "AwaitExpression" ? node.init.argument : undefined;
      if (
        imported?.type !== "ImportExpression" ||
        node.id.type !== "ObjectPattern"
      )
        return;
      if (
        node.id.properties.some(
          (property) => property.type !== "Property" || property.computed,
        )
      )
        return;
      destructured.set(
        imported.start,
        node.id.properties.map((property) => exportedName(property.key)),
      );
    },
    ImportExpression(node) {
      if (
        node.source.type === "Literal" &&
        typeof node.source.value === "string"
      ) {
        imports.push({
          kind: "dynamic",
          names: destructured.get(node.start) ?? ["*"],
          specifier: node.source.value,
        });
      }
    },
  }).visit(program);
  return imports.filter((entry) => typeof entry.specifier === "string");
}

function capabilityIndexModule(repositoryPath) {
  return /^src\/modules\/([^/]+)\/index\.[cm]?[jt]s$/u.exec(
    repositoryPath ?? "",
  )?.[1];
}

// The names a capability index.ts offers. A wildcard re-export cannot be checked for consumers.
function indexExports(indexPath, program) {
  const names = [];
  const violations = [];
  for (const node of program.body) {
    if (node.type === "ExportAllDeclaration") {
      violations.push(
        `${indexPath}: a capability index.ts names each export; replace export * from ${node.source.value}`,
      );
    }
    if (node.type !== "ExportNamedDeclaration") continue;
    names.push(
      ...node.specifiers.map((specifier) => exportedName(specifier.exported)),
    );
    const declaration = node.declaration;
    if (declaration?.id) names.push(declaration.id.name);
    for (const declarator of declaration?.declarations ?? []) {
      if (declarator.id.type === "Identifier") names.push(declarator.id.name);
    }
  }
  return { names, violations };
}

// Tests and scripts of the backend consume capability interfaces too; they are read, not checked.
function consumerRoots() {
  if (path.basename(scanRoot) !== "src") return [];
  return ["test", "scripts"]
    .map((directory) => path.resolve(scanRoot, "..", directory))
    .filter((directory) => existsSync(directory));
}

function unusedExportViolations(indexes, consumers) {
  return [...indexes].flatMap(([moduleName, { indexPath, names }]) => {
    const used = consumers.get(moduleName) ?? new Set();
    if (used.has("*")) return [];
    return names
      .filter((name) => !used.has(name))
      .map(
        (name) =>
          `${indexPath}: ${name} has no consumer outside the ${moduleName} Module; remove the export`,
      );
  });
}

function stronglyConnectedComponents(graph) {
  const order = new Map();
  const lowest = new Map();
  const stack = [];
  const components = [];
  const visit = (node) => {
    order.set(node, order.size);
    lowest.set(node, order.get(node));
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!order.has(next)) {
        visit(next);
        lowest.set(node, Math.min(lowest.get(node), lowest.get(next)));
      } else if (stack.includes(next)) {
        lowest.set(node, Math.min(lowest.get(node), order.get(next)));
      }
    }
    if (lowest.get(node) !== order.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      component.push(member);
    } while (member !== node);
    components.push(component);
  };
  for (const node of [...graph.keys()].sort()) {
    if (!order.has(node)) visit(node);
  }
  return components.filter((component) => component.length > 1);
}

// The shortest path between two Modules, for a readable diagnostic.
function shortestPath(graph, start, goal) {
  const previous = new Map([[start, start]]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === goal) break;
    for (const next of [...(graph.get(node) ?? [])].sort()) {
      if (previous.has(next)) continue;
      previous.set(next, node);
      queue.push(next);
    }
  }
  const path = [goal];
  while (path[0] !== start) path.unshift(previous.get(path[0]));
  return path;
}

// An edge lies on a cycle when both Modules share a strongly connected component of the complete
// graph. Every such edge fails and names the cycle it closes.
function moduleCycleViolations(moduleEdges) {
  const graph = new Map();
  for (const edge of moduleEdges.keys()) {
    const [from, to] = edge.split(" -> ");
    graph.set(from, new Set([...(graph.get(from) ?? []), to]));
  }
  const componentOf = new Map();
  for (const component of stronglyConnectedComponents(graph)) {
    for (const member of component) componentOf.set(member, component);
  }
  return [...moduleEdges.keys()]
    .map((edge) => edge.split(" -> "))
    .filter(
      ([from, to]) =>
        componentOf.has(from) && componentOf.get(from) === componentOf.get(to),
    )
    .map(([from, to]) => {
      const cycle = [from, ...shortestPath(graph, to, from)];
      const evidence = cycle.slice(1).map((next, step) => {
        const edge = `${cycle[step]} -> ${next}`;
        const kinds = moduleEdges.get(edge);
        const strongest = [...kinds.keys()].sort(
          (left, right) => importKindRank[right] - importKindRank[left],
        )[0];
        return `${edge}: ${kinds.get(strongest)}`;
      });
      return `Module dependency cycle ${cycle.join(" -> ")}; depend on a lower Module or invert the edge through a port (${evidence.join("; ")})`;
    });
}

if (!statSync(scanRoot).isDirectory()) {
  throw new TypeError(`Architecture scan root is not a directory: ${scanRoot}`);
}

const indexes = new Map();
const consumers = new Map();
const moduleEdges = new Map();

function recordImports(consumerPath, program, { graph }) {
  const consumerModule = owningModule(consumerPath);
  for (const { kind, names, specifier } of fileImports(program)) {
    const importedPath = importedRepositoryPath(consumerPath, specifier);
    const importedModule =
      importedPath === undefined ? undefined : owningModule(importedPath);
    if (importedModule === undefined || importedModule === consumerModule)
      continue;
    if (capabilityIndexModule(importedPath) === importedModule) {
      consumers.set(
        importedModule,
        new Set([...(consumers.get(importedModule) ?? []), ...names]),
      );
    }
    if (graph && consumerModule !== undefined) {
      const edge = `${consumerModule} -> ${importedModule}`;
      const kinds = moduleEdges.get(edge) ?? new Map();
      if (!kinds.has(kind)) kinds.set(kind, consumerPath);
      moduleEdges.set(edge, kinds);
    }
  }
}

function parsed(source) {
  const sourceText = readFileSync(source, "utf8");
  const { comments, errors, program } = parseSync(source, sourceText);
  if (errors.length > 0) {
    throw new SyntaxError(
      `Oxc could not parse ${source}: ${errors[0].message}`,
    );
  }
  return { comments, program, sourceText };
}

const findings = sourceFiles(scanRoot).flatMap((source) => {
  const { comments, program, sourceText } = parsed(source);
  const sourcePath = scannedPath(source);
  recordImports(sourcePath, program, { graph: true });
  const indexModule = capabilityIndexModule(sourcePath);
  const indexFindings = [];
  if (indexModule !== undefined) {
    const { names, violations } = indexExports(sourcePath, program);
    indexes.set(indexModule, { indexPath: sourcePath, names });
    indexFindings.push(...violations);
  }
  return [
    ...moduleSpecifiers(program).flatMap((specifier) =>
      violationsFor(source, specifier).map(
        (message) => `${sourcePath}: ${message} (${specifier})`,
      ),
    ),
    ...databaseReferenceViolations(source, program),
    ...advisoryLockViolations(source, program),
    ...handoffDelegateViolations(source, program),
    ...swallowedFailureViolations(source, sourceText, program, comments),
    ...indexFindings,
  ];
});

for (const source of consumerRoots().flatMap((root) => sourceFiles(root))) {
  recordImports(
    path.relative(backendRoot, source).split(path.sep).join("/"),
    parsed(source).program,
    { graph: false },
  );
}

findings.push(
  ...unusedExportViolations(indexes, consumers),
  ...moduleCycleViolations(moduleEdges),
);

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Backend architecture imports passed.\n");
}
