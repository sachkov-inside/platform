import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RenderedBlock } from "@inside/material-blocks";

import { MaterialBodyView } from "@/entities/material/ui/material-body-view";
import { MaterialPreview } from "@/widgets/material-authoring/ui/material-preview";

const termId = "44300000-0000-4000-8000-000000000001";
const blocks: RenderedBlock[] = [
  {
    kind: "paragraph",
    content: [
      {
        kind: "text",
        text: "развёртывание",
        marks: [{ kind: "bold" }, { kind: "term", termId }],
      },
      {
        kind: "text",
        text: "подробный материал",
        marks: [{ kind: "link", href: "/materials/first-deploy" }],
      },
    ],
  },
];

describe("term reference rendering contract", () => {
  it("Reader preserves the phrase, UUID and ordinary links without a definition snapshot", () => {
    const html = renderToStaticMarkup(
      createElement(MaterialBodyView, {
        blocks,
        path: [],
        rendering: {
          image: () => null,
          file: () => null,
          headingId: () => "heading",
        },
      }),
    );
    expect(html).toContain(`data-term-id="${termId}"`);
    expect(html).toContain("развёртывание");
    expect(html).toContain("<strong>");
    expect(html).toContain('href="/materials/first-deploy"');
    expect(html).not.toContain("Развёртывание выбранной версии приложения");
  });

  it("authoring preview retains the same UUID rather than dropping the term phrase", () => {
    const html = renderToStaticMarkup(
      createElement(MaterialPreview, {
        preview: {
          blocks,
          accessLabel: "Открытый материал",
          contentVersion: 1,
          format: "article",
          materialId: "44300000-0000-4000-8000-000000000201",
          summary: "Synthetic term contract fixture",
          tags: [],
          title: "Материал A",
          topic: "delivery",
          publicationState: "draft",
        },
      }),
    );
    expect(html).toContain(`data-term-id="${termId}"`);
    expect(html).toContain("развёртывание");
    expect(html).toContain('href="/materials/first-deploy"');
    expect(html).not.toContain("Развёртывание выбранной версии приложения");
  });
});
