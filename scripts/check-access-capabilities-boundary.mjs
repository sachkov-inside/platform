import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { parseSync, Visitor } from "oxc-parser";

/**
 * Словарь прав доступа и вывод права из него принадлежат `@inside/access-capabilities`.
 *
 * Владелец один, потому что правило нужно обеим сторонам и по разным поводам: сервер выдаёт права,
 * браузер называет состав доступа до покупки. Пока описаний было два, расхождение между ними
 * ничем не ловилось, и покупатель мог увидеть на витрине один состав, а получить другой. Проверка
 * живёт в корне, а не в каждом приложении, ровно потому, что стороны две, а правило одно.
 */
const repositoryRoot = path.resolve(process.argv[2] ?? ".");

if (!statSync(repositoryRoot).isDirectory()) {
  throw new TypeError(`Access capabilities boundary root is not a directory: ${repositoryRoot}`);
}

const vocabulary = new Set([
  "globalAccessCapabilities",
  "accessCapabilitySchema",
  "capabilitiesOpenedBy",
  "capabilitiesOpening",
  "accessComposition",
  "isGuideCapability",
  "guideCapability",
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:cts|mts|ts|tsx)$/u.test(entry.name) ? [entryPath] : [];
  });
}

function violationsIn(program) {
  const violations = [];
  const declared = (name) => {
    if (vocabulary.has(name)) {
      violations.push(`${name} belongs to @inside/access-capabilities; import it instead of declaring it again`);
    }
  };
  new Visitor({
    Literal(node) {
      if (typeof node.value === "string" && node.value.startsWith("guide:")) {
        violations.push("a Guide capability is built by @inside/access-capabilities, not by its own string");
      }
    },
    TemplateLiteral(node) {
      if (node.quasis[0]?.value.cooked?.startsWith("guide:") === true) {
        violations.push("a Guide capability is built by @inside/access-capabilities, not by its own string");
      }
    },
    VariableDeclarator(node) {
      if (node.id.type === "Identifier") declared(node.id.name);
    },
    FunctionDeclaration(node) {
      if (node.id !== null) declared(node.id.name);
    },
  }).visit(program);
  return [...new Set(violations)];
}

const applicationSources = readdirSync(path.join(repositoryRoot, "apps"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(repositoryRoot, "apps", entry.name, "src"))
  .filter((directory) => statSync(directory, { throwIfNoEntry: false })?.isDirectory() === true);

const findings = applicationSources.flatMap((directory) =>
  sourceFiles(directory).flatMap((file) => {
    const { errors, program } = parseSync(file, readFileSync(file, "utf8"));
    if (errors.length > 0) {
      throw new SyntaxError(`Oxc could not parse ${file}: ${errors[0].message}`);
    }
    return violationsIn(program).map(
      (message) => `${path.relative(repositoryRoot, file)}: ${message}`,
    );
  }),
);

if (findings.length > 0) {
  process.stderr.write(`${findings.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Access capabilities boundary passed.\n");
}
