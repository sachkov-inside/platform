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
  test("каждая клетка ссылается на существующий тест, клетку таблицы сценариев или клетку production-прохода", () => {
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
      "learner-product-a/read-product-a/body@facade-postgresql cites unknown scenario cell product-material/gift-certificate",
      "learner-product-a/read-product-a/body@nest-http cites a missing test: apps/backend/test/integration/scoped-access-http.test.ts › scoped Account access over Nest HTTP",
      "learner-product-a/read-product-a/body@learner-mcp cites a missing file: apps/backend/test/integration/no-such-file.test.ts",
      "learner-product-a/read-product-a/body@web-bff cites the production pass outside production",
      "learner-product-a/read-product-a/body@production cites a local test as production evidence",
      "learner-product-a/read-product-b/body@facade-postgresql relies on web-bff, which has no test",
      "learner-product-a/read-product-b/body@web-bff is not applicable without a reason",
      "learner-product-a/read-product-b/body misses level production",
      "duplicate row learner-product-a/read-product-b/body",
      "row teacher/read-product-a/body names unknown state teacher",
      "teacher/read-product-a/body@production has no cell in the production pass",
      "state revoked has no row",
    ]);
  });
});
