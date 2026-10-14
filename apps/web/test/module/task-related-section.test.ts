import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RenderedBlock } from "@inside/material-blocks";
import { MaterialBodyView } from "@/entities/material";
import {
  taskRelatedSectionOrder,
  taskRelatedSectionRange,
} from "@/_pages/product-task/model/task-related-section";

const heading = (text: string, level: 2 | 3 = 2): RenderedBlock => ({
  kind: "heading",
  level,
  content: [{ kind: "text", text, marks: [] }],
});
const paragraph = (text: string): RenderedBlock => ({
  kind: "paragraph",
  content: [{ kind: "text", text, marks: [] }],
});
const linked = (text: string): RenderedBlock => ({
  kind: "paragraph",
  content: [
    {
      kind: "text",
      text,
      marks: [{ kind: "bold" }, { kind: "link", href: "/materials/lesson" }],
    },
  ],
});

describe("authored task related section", () => {
  it("moves its nested subsections only, preserving the following section and every original index", () => {
    const blocks = [
      heading("Условие"),
      paragraph("Сохрани текст"),
      heading("Материалы к заданию"),
      heading("Совет", 3),
      paragraph("Совет автора"),
      heading("Файлы"),
      paragraph("Вложение автора"),
    ];
    expect(taskRelatedSectionOrder(blocks)).toEqual([2, 3, 4, 0, 1, 5, 6]);
    expect(
      taskRelatedSectionOrder([
        heading("Условие"),
        paragraph("Без раздела материалов"),
      ]),
    ).toBeUndefined();
  });
  it("keeps heading anchors, paths, marked links and attachments while enriching only links in the related section", () => {
    const blocks: RenderedBlock[] = [
      heading("Раздел"),
      linked("Обычная ссылка"),
      heading("Материалы к заданию"),
      linked("Авторский урок"),
      heading("Раздел"),
      {
        kind: "file",
        assetId: "33333333-3333-4333-8333-333333333331",
        label: "Авторский файл",
      },
    ];
    const section = taskRelatedSectionRange(blocks);
    const html = renderToStaticMarkup(
      createElement(MaterialBodyView, {
        blocks,
        blockOrder: taskRelatedSectionOrder(blocks),
        path: [],
        rendering: {
          headingId: (path) => `original-${path.join("-")}`,
          image: () => null,
          file: (block) =>
            createElement(
              "a",
              { href: `/assets/${block.assetId}` },
              block.label,
            ),
          link: (href, children, path) => {
            const index = path[0];
            if (
              section === undefined ||
              index === undefined ||
              index < section.start ||
              index >= section.end ||
              href !== "/materials/lesson"
            )
              return undefined;
            return createElement(
              "a",
              { href, "data-progress": "known" },
              children,
            );
          },
        },
      }),
    );
    expect(html.indexOf('id="материалы-к-заданию"')).toBeLessThan(
      html.indexOf('id="раздел"'),
    );
    expect(html).toContain('id="раздел-1"');
    expect(html).toContain('id="original-4"');
    expect(html).toContain(
      '<strong><a href="/materials/lesson" data-progress="known">Авторский урок</a></strong>',
    );
    expect(html).toMatch(
      /<strong><a class="[^"]+" href="\/materials\/lesson">Обычная ссылка<\/a><\/strong>/u,
    );
    expect(html).toContain(
      'href="/assets/33333333-3333-4333-8333-333333333331"',
    );
    expect(html).toContain("Авторский файл");
  });
});
