import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { withNextNavigation } from "../support/next-navigation";

import { chapterTileArt } from "@/_pages/library-discovery/model/chapter-tile-art";
import { ProductJourney } from "@/_pages/library-discovery/ui/product-journey";
import type { ProductChapter } from "@/features/library-discovery";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { productJourneyCorpus } from "../fixtures/product-journey-corpus.fixtures";

const ids = (from: number, to: number) =>
  Array.from(
    { length: to - from + 1 },
    (_, i) =>
      `33333333-3333-4333-8333-${String(from + i + 200).padStart(12, "0")}`,
  );

const plannedSummary =
  "Пишем своего агента и встраиваем его в продукт.\n\n- Инструменты и tool calling\n- **RAG.** Поиск контекста";

const roadmapChapters: readonly ProductChapter[] = [
  { id: "done", name: "Готовая глава", summary: "", materialIds: ids(1, 13) },
  {
    id: "writing",
    name: "Глава в работе",
    summary: "Пишем первые уроки.",
    materialIds: ids(14, 15),
    roadmapStatus: "writing",
    upcomingLessons: [
      { title: "Урок, который пишется", state: "writing" },
      { title: "Урок, который скоро", state: "soon" },
    ],
  },
  {
    id: "planned",
    name: "Глава в планах",
    summary: plannedSummary,
    materialIds: [],
  },
];

function render(
  chapters: readonly ProductChapter[],
  search = "",
  roadmap = true,
): { readonly html: string; readonly slugs: readonly string[] } {
  const corpus = productJourneyCorpus();
  const items = corpus.items.slice(0, 15);
  const html = renderToString(
    withNextNavigation(
      createElement(ProductJourney, {
        currentHref: productProgrammeHref("platform-inside"),
        result: {
          ...corpus,
          items,
          chapters,
          reference: {
            ...corpus.reference,
            ...(roadmap ? { roadmapUpdatedOn: "2026-11-13" } : {}),
          },
        },
      }),
      search,
      productProgrammeHref("platform-inside"),
    ),
  );
  return { html, slugs: items.map((item) => item.slug) };
}

const tiles = (html: string) =>
  [...html.matchAll(/<button[^>]*data-chapter-tile="([^"]+)"[^>]*>/gu)].map(
    (match) => match[1],
  );

describe("Programme chapter tiles", () => {
  it("shows every chapter as a tile and keeps lessons for the chapter window", () => {
    const { html } = render(roadmapChapters);
    expect(tiles(html)).toEqual(["done", "writing", "planned"]);
    expect(html).toContain("Глава 1");
    expect(html).toContain("Глава 3");
    expect(html.match(/data-chapter-badge="writing"/gu)).toHaveLength(1);
    expect(html.match(/data-chapter-badge="planned"/gu)).toHaveLength(1);
    // Lessons are read in the chapter window, so none is on the page and nothing is batched.
    expect(html).not.toContain("data-route-material=");
    expect(html).not.toContain("Показать ещё уроки");
  });

  it("reopens the chapter of the lesson the reader returns from, with its upcoming lessons", () => {
    const corpus = render(roadmapChapters);
    const slug = corpus.slugs[13] ?? "";
    const { html } = render(roadmapChapters, `at=${slug}`);
    const rows = [...html.matchAll(/data-route-material="([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(rows).toEqual([corpus.slugs[13], corpus.slugs[14]]);
    expect(
      [...html.matchAll(/data-product-ordinal="(\d+)"/gu)].map((row) => row[1]),
    ).toEqual(["1", "2"]);
    expect(html).toContain("Пишем первые уроки.");
    const upcoming = [
      ...html.matchAll(
        /<li[^>]*data-roadmap-upcoming="([a-z]+)"[^>]*>(.*?)<\/li>/gu,
      ),
    ];
    expect(upcoming.map((match) => match[1])).toEqual(["writing", "soon"]);
    expect(upcoming[0]?.[2]).toContain(">3<");
  });

  it("derives the status of each chapter without a stored roadmap", () => {
    const { html } = render(
      roadmapChapters.map(
        ({ roadmapStatus: _status, upcomingLessons: _upcoming, ...chapter }) =>
          chapter,
      ),
      "",
      false,
    );
    expect(
      [...html.matchAll(/data-chapter-status="([a-z]+)"/gu)].map(
        (match) => match[1],
      ),
    ).toEqual(["done", "done", "planned"]);
    expect(html).not.toContain('data-chapter-badge="writing"');
  });

  it("keeps the batched list of a product without chapters", () => {
    const { html } = render([]);
    expect(tiles(html)).toEqual([]);
    expect(html.match(/data-route-material=/gu)).toHaveLength(12);
    expect(html).toContain("Показать ещё уроки");
  });
});

describe("Chapter tile art", () => {
  it("keeps the illustration of a known chapter by its name", () => {
    expect(
      chapterTileArt("Свой harness и первый цикл работы с агентом", 0),
    ).toEqual({ art: "harness", tone: "ink" });
    expect(chapterTileArt("Software factory и оркестрация", 7).art).toBe(
      "factory",
    );
  });

  it("gives an unknown chapter a neutral illustration that does not depend on the name", () => {
    expect(chapterTileArt("Новая глава", 0)).toEqual({
      art: "lessons",
      tone: "sand",
    });
    expect(chapterTileArt("Другая глава", 0)).toEqual({
      art: "lessons",
      tone: "sand",
    });
  });
});
