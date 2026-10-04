import {
  accessCheckMatrix,
  type AccessCheckRowShape,
} from "../access-check-matrix.js";

/**
 * Негативная фикстура матрицы проверок доступа. Она доказывает, что контроль ловит ссылку на
 * несуществующий тест и файл, неизвестную клетку таблицы сценариев, новую проверку не той задачи,
 * локальный тест на уровне production, опору на уровень без теста, неприменимость без причины,
 * пропущенный уровень, дубликат строки, неизвестное состояние и состояние без строк.
 */
const learnerReadsA = accessCheckMatrix.find(
  (row) =>
    row.state === "learner-guide-a" &&
    row.action === "read-guide-a" &&
    row.surface === "body",
);
const learnerReadsB = accessCheckMatrix.find(
  (row) =>
    row.state === "learner-guide-a" &&
    row.action === "read-guide-b" &&
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
        name: "learner of Guide A reads a Guide that does not exist",
      },
      "learner-mcp": {
        kind: "test",
        file: "apps/backend/test/integration/no-such-file.test.ts",
        name: "learner reads Guide A",
      },
      "web-bff": { kind: "new-check", issue: 906 },
      production: {
        kind: "test",
        file: "apps/backend/test/integration/scoped-access-http.test.ts",
        name: "anonymous reader gets no protected bytes of either Guide while the public Material stays open",
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
