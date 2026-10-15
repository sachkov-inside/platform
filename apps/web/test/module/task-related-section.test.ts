import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RenderedBlock } from "@inside/material-blocks";
import { TaskPageBody } from "@/_pages/product-task/ui/task-page-body";
import { taskRelatedMaterialHref } from "@/_pages/product-task/ui/task-related-materials.client";
import { internalRoute } from "@/shared/routing/internal-route";
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
const linked = (text: string, href = "/materials/lesson"): RenderedBlock => ({
  kind: "paragraph",
  content: [
    {
      kind: "text",
      text,
      marks: [{ kind: "bold" }, { kind: "link", href }],
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
  it("retains authored query values, repeated parameters and the fragment while enriching only the related link with its real Material ID", () => {
    const href = "/materials/lesson?view=detail&tag=one&tag=two#first-section";
    const returnTo = internalRoute(
      "/products/course/programme?part=materials&at=lesson",
    );
    const target = new URL(
      taskRelatedMaterialHref("lesson", returnTo, internalRoute(href)),
      "https://inside.invalid",
    );
    expect(target.pathname).toBe("/materials/lesson");
    expect(target.searchParams.get("view")).toBe("detail");
    expect(target.searchParams.getAll("tag")).toEqual(["one", "two"]);
    expect(target.searchParams.get("from")).toBe(returnTo);
    expect(target.hash).toBe("#first-section");
    const materialId = "33333333-3333-4333-8333-333333333331";
    const html = renderToStaticMarkup(
      createElement(TaskPageBody, {
        page: {
          title: "Задание",
          summary: "",
          cover: null,
          artifacts: [],
          body: {
            schemaVersion: 1,
            blocks: [
              heading("Условие"),
              linked("Обычная ссылка", href),
              heading("Материалы к заданию"),
              linked("Связанный урок", href),
            ],
          },
        },
        productSlug: "course",
        code: "task",
        version: 1,
        returnTo,
        relatedMaterials: [
          {
            materialId,
            slug: "lesson",
            title: "Урок",
            availability: "available",
          },
        ],
      }),
    );
    expect(html).toContain(`data-task-related-material="${materialId}"`);
    expect(html.match(/data-task-related-material=/gu)).toHaveLength(1);
    expect(html).toContain(
      "view=detail&amp;tag=one&amp;tag=two&amp;from=%2Fproducts%2Fcourse%2Fprogramme%3Fpart%3Dmaterials%26at%3Dlesson&amp;anchor=task%3Atask#first-section",
    );
    expect(html).toMatch(
      /href="\/materials\/lesson\?view=detail&amp;tag=one&amp;tag=two&amp;from=[^"]*&amp;anchor=task%3Atask#first-section">Обычная ссылка<\/a>/u,
    );
  });
});
