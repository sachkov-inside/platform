import { accessScenarioTable } from "./access-scenarios.js";
import {
  accessCheckActions,
  accessCheckLevels,
  accessCheckRowId,
  accessCheckStates,
  accessCheckSurfaces,
  type AccessCheckEvidence,
  type AccessCheckLevel,
  type AccessCheckRowShape,
  type plannedCheckIssues,
} from "./access-check-matrix.js";

/** Новая проверка какой задачи допустима на уровне: fullstack делает #904, production-проход — #906. */
const plannedIssueOfLevel: Readonly<
  Partial<Record<AccessCheckLevel, (typeof plannedCheckIssues)[number]>>
> = { "web-bff": 904, production: 906 };

/**
 * Контроль полноты матрицы проверок доступа. Каждая строка покрывает все уровни; каждая клетка
 * ссылается на существующий тест (файл есть и объявляет `test(` или `it(` с этим названием),
 * на клетку таблицы сценариев доступа, на новую проверку своей задачи или на тест другого уровня
 * той же строки; неприменимость и опора на другой уровень объясняют причину. Production-клетка
 * не принимает локальный тест. `readFile` получает путь от корня репозитория и возвращает `null`,
 * если файла нет. Возвращает список нарушений; пустой список — матрица цела.
 */
export function checkAccessCheckMatrix(
  rows: readonly AccessCheckRowShape[],
  readFile: (path: string) => string | null,
): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = accessCheckRowId(row);
    if (seen.has(id)) problems.push(`duplicate row ${id}`);
    seen.add(id);
    for (const [kind, name, known] of [
      ["state", row.state, accessCheckStates],
      ["action", row.action, accessCheckActions],
      ["surface", row.surface, accessCheckSurfaces],
    ] as const)
      if (!(known as readonly string[]).includes(name))
        problems.push(`row ${id} names unknown ${kind} ${name}`);
    for (const level of accessCheckLevels) {
      const evidence = row.levels[level];
      if (evidence === undefined) {
        problems.push(`${id} misses level ${level}`);
        continue;
      }
      const problem = evidenceProblem(row, level, evidence, readFile);
      if (problem !== null) problems.push(`${id}@${level} ${problem}`);
    }
    for (const level of Object.keys(row.levels))
      if (!(accessCheckLevels as readonly string[]).includes(level))
        problems.push(`${id} names unknown level ${level}`);
  }
  for (const state of accessCheckStates)
    if (!rows.some((row) => row.state === state))
      problems.push(`state ${state} has no row`);
  return problems;
}

function evidenceProblem(
  row: AccessCheckRowShape,
  level: AccessCheckLevel,
  evidence: AccessCheckEvidence,
  readFile: (path: string) => string | null,
): string | null {
  switch (evidence.kind) {
    case "test": {
      if (level === "production")
        return "cites a local test as production evidence";
      const source = readFile(evidence.file);
      if (source === null) return `cites a missing file: ${evidence.file}`;
      return declaresTest(source, evidence.name)
        ? null
        : `cites a missing test: ${evidence.file} › ${evidence.name}`;
    }
    case "scenario-cell": {
      if (level !== "facade-postgresql")
        return `cites scenario cell ${evidence.cell} outside facade-postgresql`;
      const [surface, ground] = evidence.cell.split("/");
      const cells: Readonly<Record<string, Readonly<Record<string, unknown>>>> =
        accessScenarioTable.cells;
      return surface !== undefined &&
        ground !== undefined &&
        Object.hasOwn(cells, surface) &&
        Object.hasOwn(cells[surface] ?? {}, ground)
        ? null
        : `cites unknown scenario cell ${evidence.cell}`;
    }
    case "new-check": {
      const expected = plannedIssueOfLevel[level];
      return expected === evidence.issue
        ? null
        : `marks a new check of #${String(evidence.issue)}, expected ${
            expected === undefined
              ? "an existing test at this level"
              : `#${String(expected)}`
          }`;
    }
    case "relies-on": {
      if (evidence.because.trim().length === 0)
        return "relies on another level without a reason";
      if (evidence.level === level || evidence.level === "production")
        return `relies on ${evidence.level}, which cannot prove it`;
      const target = row.levels[evidence.level];
      return target?.kind === "test" || target?.kind === "scenario-cell"
        ? null
        : `relies on ${evidence.level}, which has no test`;
    }
    case "not-applicable":
      return evidence.because.trim().length === 0
        ? "is not applicable without a reason"
        : null;
  }
}

/**
 * Файл объявляет исполняемый тест с этим названием: `test(` или `it(` (с `.only` или `.concurrent`)
 * и сразу литерал названия в кавычках или обратных кавычках. Комментарий, `describe`, `test.skip`
 * и константа с тем же текстом объявлением не считаются.
 */
function declaresTest(source: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `\\b(?:test|it)(?:\\.(?:only|concurrent))?\\(\\s*(["'\`])${escaped}\\1`,
    "u",
  ).test(source);
}
