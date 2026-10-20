import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MaterialCard } from "@/entities/material";
import {
  MaterialReaderView,
  MaterialReaderHeader,
} from "@/_pages/material-reader/ui/material-reader-view";
import {
  MaterialReaderAccess,
  MaterialReaderPending,
} from "@/_pages/material-reader/ui/material-reader-states";
import type { MaterialReaderMetadata } from "@/_pages/material-reader/model/material-reader-view";

const material: MaterialReaderMetadata = {
  access: "free",
  contentVersion: 1,
  cover: null,
  difficulty: null,
  outcomes: [],
  format: { name: "Гайд", slug: "guide" },
  materialId: "02000000-0000-4000-8000-000000000010",
  publishedAt: "2026-10-15T00:00:00.000Z",
  seriesMemberships: [],
  slug: "share-example",
  summary: "",
  tags: [],
  title: "Проверка публичности",
  topic: { name: "AI", slug: "ai" },
};
const shareLabel = "Поделиться материалом";

describe("Material share visibility", () => {
  for (const access of ["free", "closed"] as const) {
    for (const variant of ["feed", "row", "series"] as const) {
      it(`omits sharing from ${access} ${variant} cards`, () => {
        const html = renderToStaticMarkup(
          createElement(MaterialCard, {
            variant,
            readingStatus: createElement("span", null, "Не изучено"),
            material: {
              ...material,
              access,
              availability: "available",
              seriesMemberships: [],
              format: material.format.name,
              topic: material.topic.name,
              topicSlug: material.topic.slug,
            },
          }),
        );
        expect(html).not.toContain(shareLabel);
        expect(html).toContain(material.title);
      });
    }

    it(`shares ${access} material only when public, including authorized closed readers`, () => {
      const html = renderToStaticMarkup(
        createElement(MaterialReaderView, {
          material: { ...material, access },
          body: [],
          primaryVideo: null,
        }),
      );
      expect(html.match(/Поделиться материалом/gu) ?? []).toHaveLength(
        access === "free" ? 2 : 0,
      );
    });

    it(`gates pending and header actions by ${access} publication access`, () => {
      for (const component of [MaterialReaderPending, MaterialReaderHeader]) {
        const html = renderToStaticMarkup(
          createElement(component, { material: { ...material, access } }),
        );
        expect(html.includes(shareLabel)).toBe(access === "free");
      }
    });
  }

  it("omits sharing from the closed access-required screen", () => {
    const html = renderToStaticMarkup(
      createElement(MaterialReaderAccess, {
        material: { ...material, access: "closed" },
        invitation: null,
      }),
    );
    expect(html).not.toContain(shareLabel);
    expect(html).toContain("Продолжение для участников");
  });
});
