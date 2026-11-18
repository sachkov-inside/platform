// @ts-check

/** @param {string} text @returns {Extract<import("@inside/material-blocks").RenderedBlock, {kind: "paragraph"}>} */
function paragraph(text) {
  return { kind: "paragraph", content: [{ kind: "text", text, marks: [] }] };
}

/** External document delivery for the public glossary lifetime tests (#2419).
 * @param {string | undefined} method
 * @param {URL} url
 * @param {object} projection
 * @returns {{status: number; value: unknown} | null}
 */
export function glossaryLifetimeRoute(method, url, projection) {
  if (method !== "GET") return null;
  const first = url.pathname === "/materials/glossary-lifetime-first";
  if (!first && url.pathname !== "/materials/glossary-lifetime-second")
    return null;
  /** @type {import("@inside/material-blocks").RenderedBlock} */
  const mention = {
    kind: "paragraph",
    content: [
      { kind: "text", text: "Команда обсуждает ", marks: [] },
      {
        kind: "text",
        text: "ограниченные контексты",
        marks: [{ kind: "link", href: "term:bounded-context" }],
      },
      { kind: "text", text: " в общей модели.", marks: [] },
    ],
  };
  /** @type {import("@inside/material-blocks").RenderedBlock} */
  const next = {
    kind: "paragraph",
    content: [
      {
        kind: "text",
        text: "Следующий пример",
        marks: [{ kind: "link", href: "/materials/glossary-lifetime-second" }],
      },
    ],
  };
  return {
    status: 200,
    value: {
      kind: "available",
      cacheScope: "public",
      glossaryTerms: first
        ? [
            {
              id: "bounded-context",
              title: "Ограниченный контекст",
              englishTitle: "Bounded context",
              shortDefinition:
                "Граница, внутри которой у слов модели один смысл.",
              fullDefinition:
                "Часть системы со своей моделью и своим языком.\n\nСлово «заказ» внутри одной границы значит одно, в соседней другое.",
            },
          ]
        : [],
      lessonTerms: [],
      primaryVideo: null,
      projection: {
        ...projection,
        access: "free",
        materialId: first
          ? "50002419-0000-4000-8000-000000000001"
          : "50002419-0000-4000-8000-000000000002",
        slug: first ? "glossary-lifetime-first" : "glossary-lifetime-second",
        title: first ? "Проверка словаря" : "Следующий пример",
        productMemberships: [],
      },
      body: {
        schemaVersion: 1,
        blocks: first
          ? [
              paragraph(
                "Синтетический документ проверяет обычное чтение определения.",
              ),
              mention,
              next,
              ...Array.from({ length: 12 }, (_, index) =>
                paragraph(
                  `Абзац ${String(index + 1)}. Читатель прокручивает материал, сохраняя понятный контекст и положение определения.`,
                ),
              ),
            ]
          : [
              paragraph(
                "Второй синтетический документ для настоящего Next-перехода.",
              ),
            ],
      },
    },
  };
}
