import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import * as readerHistory from "@/shared/ui/reader-history.client";
import {
  MaterialReaderPending,
  MaterialReaderAccess,
} from "@/_pages/material-reader/ui/material-reader-states";
import { MaterialReaderView } from "@/_pages/material-reader/ui/material-reader-view";
import { resolveProductReaderContext } from "@/_pages/material-reader/model/product-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { courseSource } from "@/storybook/course-reading.fixtures";

let track: MockInstance<typeof readerHistory.ReaderHistoryTracker>;
beforeEach(() => {
  track = vi.spyOn(readerHistory, "ReaderHistoryTracker");
});
function renderReader(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(PathnameContext.Provider, {
      value: "/materials/aie-product-brief",
      children: createElement(SearchParamsContext.Provider, {
        value: new URLSearchParams(),
        children: node,
      }),
    }),
  );
}

const material = {
  materialId: "02000000-0000-4000-8000-000000000010",
  contentVersion: 1,
  access: "free" as const,
  cover: null,
  difficulty: null,
  outcomes: [],
  format: { name: "Гайд", slug: "guide" },
  publishedAt: "2026-10-15T00:00:00.000Z",
  productMemberships: [],
  slug: "aie-product-brief",
  summary: "",
  tags: [],
  title: "Бриф заказчика",
  topic: { name: "AI", slug: "ai" },
};

describe("Reader history activation boundary", () => {
  it("waits for verified personal context instead of consuming the originating entry in the public shell", async () => {
    const returnTarget = parseMaterialReaderReturnTarget(
      "/products/ai-engineering/programme",
    );
    renderReader(
      createElement(MaterialReaderPending, {
        material,
        returnTarget,
        productContext: null,
      }),
    );
    expect(track).not.toHaveBeenCalled();
    const context = await Promise.resolve(
      resolveProductReaderContext({
        currentMaterialSlug: material.slug,
        returnTarget,
        product: {
          ...courseSource,
          chapters: courseSource.chapters.map((chapter) => ({
            ...chapter,
            summary: "",
          })),
        },
        anchor: { kind: "task", code: "aie-ch1-onboarding" },
      }),
    );
    const readyHtml = renderReader(
      createElement(MaterialReaderView, {
        material,
        body: [],
        primaryVideo: null,
        returnTarget,
        productContext: context,
      }),
    );
    expect(track.mock.calls.map(([props]) => props)).toEqual([
      {
        path: "/materials/aie-product-brief",
        originHref: "/products/ai-engineering/tasks/aie-ch1-onboarding",
      },
    ]);
    expect(readyHtml).toContain("data-reader-history-tracker");
  });
});

describe("Locked material course entry", () => {
  it("links to the course landing even before a purchase offer exists", () => {
    const returnTarget = parseMaterialReaderReturnTarget(
      "/products/ai-engineering/programme",
    );
    const productContext = resolveProductReaderContext({
      currentMaterialSlug: material.slug,
      returnTarget,
      product: {
        ...courseSource,
        chapters: courseSource.chapters.map((chapter) => ({
          ...chapter,
          summary: "",
        })),
      },
      anchor: { kind: "task", code: "aie-ch1-onboarding" },
    });
    const html = renderReader(
      createElement(MaterialReaderAccess, {
        material: {
          ...material,
          access: "closed",
          productMemberships: [
            {
              ordinal: 1,
              product: {
                id: "course",
                name: "AI Engineering",
                slug: "ai-engineering",
              },
            },
          ],
        },
        returnTarget: parseMaterialReaderReturnTarget(
          "/products/ai-engineering/programme",
        ),
        productContext,
        invitation: null,
      }),
    );
    expect(html).toMatch(
      /href="\/products\/ai-engineering"[^>]*>Получить доступ/u,
    );
    expect(html).not.toContain("Купить доступ сейчас нельзя");
  });
});
