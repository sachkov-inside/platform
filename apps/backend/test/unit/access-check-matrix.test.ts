import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  accessCheckLevels,
  accessCheckMatrix,
  accessCheckStates,
} from "../access-scenarios/access-check-matrix.js";
import { checkAccessCheckMatrix } from "../access-scenarios/check-access-check-matrix.js";
import { brokenAccessCheckMatrix } from "../access-scenarios/fixtures/broken-access-check-matrix.js";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/** Читает файл теста от корня репозитория; `null`, если файла нет. */
function readRepositoryFile(path: string): string | null {
  const absolute = `${repositoryRoot}${path}`;
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
}

describe("матрица проверок доступа", () => {
  test("каждая клетка ссылается на существующий тест, клетку таблицы сценариев или новую проверку", () => {
    expect(
      checkAccessCheckMatrix(accessCheckMatrix, readRepositoryFile),
    ).toEqual([]);
    const states = new Set(accessCheckMatrix.map((row) => row.state));
    expect([...states].sort()).toEqual([...accessCheckStates].sort());
    for (const row of accessCheckMatrix)
      expect(Object.keys(row.levels).sort()).toEqual(
        [...accessCheckLevels].sort(),
      );
  });

  test("ссылка в никуда, чужой уровень, пропуск и неизвестное имя роняют контроль", () => {
    expect(
      checkAccessCheckMatrix(brokenAccessCheckMatrix, readRepositoryFile),
    ).toEqual([
      "learner-guide-a/read-guide-a/body@facade-postgresql cites unknown scenario cell product-material/gift-certificate",
      "learner-guide-a/read-guide-a/body@nest-http cites a missing test: apps/backend/test/integration/scoped-access-http.test.ts › learner of Guide A reads a Guide that does not exist",
      "learner-guide-a/read-guide-a/body@learner-mcp cites a missing file: apps/backend/test/integration/no-such-file.test.ts",
      "learner-guide-a/read-guide-a/body@web-bff marks a new check of #906, expected #904",
      "learner-guide-a/read-guide-a/body@production cites a local test as production evidence",
      "learner-guide-a/read-guide-b/body@facade-postgresql relies on web-bff, which has no test",
      "learner-guide-a/read-guide-b/body@web-bff is not applicable without a reason",
      "learner-guide-a/read-guide-b/body misses level production",
      "duplicate row learner-guide-a/read-guide-b/body",
      "row teacher/read-guide-a/body names unknown state teacher",
      "state revoked has no row",
    ]);
  });
});
