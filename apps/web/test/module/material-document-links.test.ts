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

// Feedback 13.11.2026: `[короткий `AGENTS.md` с указателями](#anchor)` read as three links.
describe.each(Object.entries(surfaces))(
  "%s link with mixed content",
  (_, surface) => {
    const link = { kind: "link", href: "#anchor" } as const;
    const anchors = (html: string) => html.match(/<a\b[^>]*>.*?<\/a>/gu) ?? [];

    it("renders one anchor around text and inline code under the same link", () => {
      const html = renderToStaticMarkup(
        surface([
          {
            kind: "paragraph",
            content: [
              { kind: "text", text: "Начни с ", marks: [] },
              { kind: "text", text: "короткий ", marks: [link] },
              {
                kind: "text",
                text: "AGENTS.md",
                marks: [link, { kind: "code" }],
              },
              { kind: "text", text: " с указателями", marks: [link] },
              { kind: "text", text: ".", marks: [] },
            ],
          },
        ]),
      );
      const found = anchors(html);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(
        /^<a [^>]*href="#anchor"[^>]*>короткий <code[^>]*>AGENTS\.md<\/code> с указателями<\/a>$/u,
      );
    });

    it("keeps one anchor when the code mark comes before the link mark", () => {
      const html = renderToStaticMarkup(
        surface([
          {
            kind: "paragraph",
            content: [
              { kind: "text", text: "документации ", marks: [link] },
              {
                kind: "text",
                text: "gh auth login",
                marks: [{ kind: "code" }, link],
              },
            ],
          },
        ]),
      );
      const found = anchors(html);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(
        /^<a [^>]*>документации <code[^>]*>gh auth login<\/code><\/a>$/u,
      );
    });

    it("keeps separate anchors for different addresses and for text between links", () => {
      const html = renderToStaticMarkup(
        surface([
          {
            kind: "paragraph",
            content: [
              { kind: "text", text: "первая", marks: [link] },
              {
                kind: "text",
                text: "вторая",
                marks: [{ kind: "link", href: "#other" }],
              },
              { kind: "text", text: " и ", marks: [] },
              { kind: "text", text: "третья", marks: [link] },
            ],
          },
        ]),
      );
      expect(
        anchors(html).map((anchor) => anchor.replace(/<[^>]+>/gu, "")),
      ).toEqual(["первая", "вторая", "третья"]);
    });
  },
);
