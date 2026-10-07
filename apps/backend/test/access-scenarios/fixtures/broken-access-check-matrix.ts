import {
  accessCheckMatrix,
  type AccessCheckRowShape,
} from "../access-check-matrix.js";

/**
 * Негативная фикстура матрицы проверок доступа. Она доказывает, что контроль ловит ссылку на
 * несуществующий тест (в том числе на название `describe`) и файл, неизвестную клетку таблицы
 * сценариев, production-проход вне уровня production и строку без клетки прохода, локальный тест на
 * уровне production, опору на уровень без теста, неприменимость без причины,
 * пропущенный уровень, дубликат строки, неизвестное состояние и состояние без строк.
 */
const learnerReadsA = accessCheckMatrix.find(
  (row) =>
    row.state === "learner-product-a" &&
    row.action === "read-product-a" &&
    row.surface === "body",
);
const learnerReadsB = accessCheckMatrix.find(
  (row) =>
    row.state === "learner-product-a" &&
    row.action === "read-product-b" &&
    row.surface === "body",
);
if (learnerReadsA === undefined || learnerReadsB === undefined)
  throw new Error("Matrix fixture rows are missing");

const { production: _production, ...withoutProduction } = learnerReadsB.levels;

export const brokenAccessCheckMatrix: readonly AccessCheckRowShape[] = [
  ...accessCheckMatrix.filter(
    (row) =>
      row.state !== "revoked" && row !== learnerReadsA && row !== learnerReadsB,
  ),
  {
    ...learnerReadsA,
    levels: {
      "facade-postgresql": {
        kind: "scenario-cell",
        cell: "product-material/gift-certificate",
      },
      "nest-http": {
        kind: "test",
        file: "apps/backend/test/integration/scoped-access-http.test.ts",
        // Название `describe`, а не теста: литерал есть в файле, объявления теста нет.
        name: "scoped Account access over Nest HTTP",
      },
      "learner-mcp": {
        kind: "test",
        file: "apps/backend/test/integration/no-such-file.test.ts",
        name: "learner reads Product A",
      },
      "web-bff": { kind: "production-pass" },
      production: {
        kind: "test",
        file: "apps/backend/test/integration/scoped-access-http.test.ts",
        name: "anonymous reader gets no protected bytes of either Product while the public Material stays open",
      },
    },
  },
  {
    ...learnerReadsB,
    levels: {
      ...withoutProduction,
      "facade-postgresql": {
        kind: "relies-on",
        level: "web-bff",
        because: "Опора на уровень, где теста нет",
      },
      "web-bff": { kind: "not-applicable", because: " " },
    },
  },
  learnerReadsB,
  {
    ...learnerReadsA,
    state: "teacher",
  },
];
