// @ts-check

/** @param {number} columns @returns {Extract<import("@inside/material-blocks").RenderedBlock, {kind: "table"}>} */
function table(columns) {
  return {
    kind: "table",
    rows: [
      {
        cells: Array.from({ length: columns }, (_, index) => ({
          header: true,
          content: [
            {
              kind: "paragraph",
              content: [
                { kind: "text", text: `Поле ${String(index + 1)}`, marks: [] },
              ],
            },
          ],
        })),
      },
    ],
  };
}

/** External backend document inputs for the public Reader SSR/hydration contract (#2408).
 * @param {string | undefined} method
 * @param {URL} url
 * @param {object} projection
 * @returns {{status: number; value: unknown} | null}
 */
export function tableNamesRoute(method, url, projection) {
  if (method !== "GET") return null;
  const single = url.pathname === "/materials/table-names-single";
  const order = url.pathname === "/materials/table-names-order";
  if (!single && !order && url.pathname !== "/materials/table-names-nested")
    return null;
  const inner = table(8);
  /** @type {import("@inside/material-blocks").RenderedBlock} */
  const outer = {
    kind: "table",
    rows: [
      {
        cells: [
          { header: false, content: [inner] },
          {
            header: false,
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Внешняя ячейка", marks: [] }],
              },
            ],
          },
          {
            header: false,
            content: [
              {
                kind: "paragraph",
                content: [{ kind: "text", text: "Ещё одна ячейка", marks: [] }],
              },
            ],
          },
        ],
      },
    ],
  };
  /** @type {import("@inside/material-blocks").RenderedBlock} */
  const exercise = {
    kind: "order",
    id: "table-reading-order",
    reveal: "none",
    question: [
      {
        kind: "paragraph",
        content: [
          { kind: "text", text: "Расставь шаги по порядку.", marks: [] },
        ],
      },
    ],
    steps: ["Подготовить", "Вычислить", "Проверить результат"].map(
      (label, index) => ({
        id: `step-${String(index + 1)}`,
        content: [
          {
            kind: "paragraph",
            content: [{ kind: "text", text: label, marks: [] }],
          },
          inner,
        ],
        explanation: [
          {
            kind: "paragraph",
            content: [{ kind: "text", text: `Разбор: ${label}`, marks: [] }],
          },
        ],
      }),
    ),
  };
  return {
    status: 200,
    value: {
      kind: "available",
      cacheScope: "public",
      glossaryTerms: [],
      lessonTerms: [],
      primaryVideo: null,
      projection: {
        ...projection,
        access: "free",
        materialId: single
          ? "50002408-0000-4000-8000-000000000001"
          : order
            ? "50002408-0000-4000-8000-000000000003"
            : "50002408-0000-4000-8000-000000000002",
        slug: single
          ? "table-names-single"
          : order
            ? "table-names-order"
            : "table-names-nested",
        title: single
          ? "Одна таблица"
          : order
            ? "Таблицы в упражнении"
            : "Вложенные таблицы",
        productMemberships: [],
      },
      body: {
        schemaVersion: 1,
        blocks: single ? [inner] : order ? [exercise] : [outer, inner],
      },
    },
  };
}
