import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MaterialBodyView } from "@/entities/material/ui/material-body-view";
import type { RenderedBlock } from "@/entities/material.model";
import { MaterialPreview } from "@/widgets/material-authoring/ui/material-preview";

const surfaces = {
  reader: (blocks: readonly RenderedBlock[]) =>
    createElement(MaterialBodyView, {
      blocks,
      path: [],
      rendering: {
        headingId: () => "section",
        image: () => null,
        file: () => null,
      },
    }),
  preview: (blocks: readonly RenderedBlock[]) =>
    createElement(MaterialPreview, {
      preview: {
        blocks,
        accessLabel: "Открытый",
        contentVersion: 1,
        format: "article",
        materialId: "material",
        summary: "",
        tags: [],
        title: "Материал",
        topic: "ai",
        publicationState: "draft",
      },
    }),
};

describe.each(Object.entries(surfaces))("%s document links", (_, surface) => {
  it.each([
    "/materials/next#section",
    "#section",
    "?mode=practice",
    "mailto:author@example.com",
    "tel:+79990000000",
  ])("keeps the existing navigation for %s", (href) => {
    const html = renderToStaticMarkup(
      surface([
        {
          kind: "paragraph",
          content: [
            { kind: "text", text: "Дальше", marks: [{ kind: "link", href }] },
          ],
        },
      ]),
    );
    expect(html).not.toContain('target="_blank"');
    expect(html).toContain(`href="${href}"`);
  });
  it.each([
    "https://example.com/docs",
    "http://example.com/docs",
    "//example.com/docs",
  ])(
    "opens %s in a separate tab without access to the source window",
    (href) => {
      const html = renderToStaticMarkup(
        surface([
          {
            kind: "paragraph",
            content: [
              {
                kind: "text",
                text: "Документация",
                marks: [{ kind: "link", href }],
              },
            ],
          },
        ]),
      );
      expect(html).toContain('target="_blank"');
      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain(`href="${href}"`);
    },
  );
});
