import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MaterialReaderPending } from "@/_pages/material-reader/ui/material-reader-states";
import { MaterialReaderView } from "@/_pages/material-reader/ui/material-reader-view";
import { resolveSeriesReaderContext } from "@/_pages/material-reader/model/series-reader-context";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { courseSource } from "@/storybook/course-reading.fixtures";

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/shared/ui/reader-history.client", () => ({
  ReaderHistoryTracker: (props: {
    readonly path: string;
    readonly originHref?: string;
  }) => {
    track(props);
    return null;
  },
  ReaderOriginLink: ({
    href,
    children,
  }: {
    readonly href: string;
    readonly children: ReactNode;
  }) => createElement("a", { href }, children),
}));

const material = {
  materialId: "02000000-0000-4000-8000-000000000010",
  contentVersion: 1,
  access: "free" as const,
  cover: null,
  difficulty: null,
  outcomes: [],
  format: { name: "Гайд", slug: "guide" },
  publishedAt: "2026-10-15T00:00:00.000Z",
  seriesMemberships: [],
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
    renderToStaticMarkup(
      createElement(MaterialReaderPending, {
        material,
        returnTarget,
        seriesContext: null,
      }),
    );
    expect(track).not.toHaveBeenCalled();
    const context = await Promise.resolve(
      resolveSeriesReaderContext({
        currentMaterialSlug: material.slug,
        returnTarget,
        series: {
          ...courseSource,
          chapters: courseSource.chapters.map((chapter) => ({
            ...chapter,
            summary: "",
          })),
        },
        anchor: { kind: "task", code: "aie-ch1-onboarding" },
      }),
    );
    renderToStaticMarkup(
      createElement(MaterialReaderView, {
        material,
        body: [],
        primaryVideo: null,
        returnTarget,
        seriesContext: context,
      }),
    );
    expect(track).toHaveBeenCalledExactlyOnceWith({
      path: "/materials/aie-product-brief",
      originHref: "/products/ai-engineering/tasks/aie-ch1-onboarding",
    });
  });
});
