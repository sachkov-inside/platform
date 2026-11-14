import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductJourney } from "@/_pages/library-discovery/ui/product-journey";
import type { ProductChapter } from "@/features/library-discovery";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { productJourneyCorpus } from "@/storybook/product-journey-corpus.fixtures";

vi.mock("next/navigation", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const ids = (from: number, to: number) =>
  Array.from(
    { length: to - from + 1 },
    (_, i) => `material-${String(from + i)}`,
  );

const plannedSummary =
  "Пишем своего агента и встраиваем его в продукт.\n\n- Инструменты и tool calling\n- **RAG.** Поиск контекста";

function chapters(roadmap: boolean): readonly ProductChapter[] {
  return [
    { id: "done", name: "Готовая глава", summary: "", materialIds: ids(1, 13) },
    {
      id: "writing",
      name: "Глава в работе",
      summary: "",
      materialIds: ids(14, 15),
      ...(roadmap
        ? {
            roadmapStatus: "writing" as const,
            upcomingLessons: [
              { title: "Урок, который пишется", state: "writing" as const },
              { title: "Урок, который скоро", state: "soon" as const },
            ],
          }
        : {}),
    },
    {
      id: "planned",
      name: "Глава в планах",
      summary: plannedSummary,
      materialIds: [],
    },
  ];
}

function render(roadmap: boolean): string {
  const corpus = productJourneyCorpus();
  return renderToString(
    createElement(ProductJourney, {
      currentHref: productProgrammeHref("platform-inside"),
      result: {
        ...corpus,
        items: corpus.items.slice(0, 15),
        chapters: chapters(roadmap),
        reference: {
          ...corpus.reference,
          ...(roadmap ? { roadmapUpdatedOn: "2026-11-13" } : {}),
        },
      },
    }),
  );
}

/** The opening tag of the roadmap disclosure of a status. */
function disclosure(html: string, status: string): string {
  const match = new RegExp(
    `<(details|div)[^>]*data-roadmap-chapter="${status}"[^>]*>`,
    "u",
  ).exec(html);
  if (match === null) throw new Error(`Missing ${status} chapter`);
  return match[0];
}

describe("Course roadmap programme (#2141)", () => {
  it("folds every chapter and opens only the chapter in work", () => {
    const html = render(true);
    expect(disclosure(html, "done")).toMatch(/^<details/u);
    expect(disclosure(html, "done")).not.toMatch(/\sopen=""/u);
    expect(disclosure(html, "writing")).toMatch(/\sopen=""/u);
    expect(disclosure(html, "planned")).not.toMatch(/\sopen=""/u);
  });

  it("marks only the chapter in work and the planned chapter", () => {
    const html = render(true);
    expect(html.match(/data-roadmap-badge="writing"/gu)).toHaveLength(1);
    expect(html.match(/data-roadmap-badge="planned"/gu)).toHaveLength(1);
    expect(html).toContain("Готово 2 из 4 уроков");
  });

  it("shows every published lesson, then the upcoming ones without links", () => {
    const html = render(true);
    // Folded chapters hide their last lesson from the reveal observer: no batches.
    expect(html.match(/data-route-material=/gu)).toHaveLength(15);
    expect(html).not.toContain("Показать ещё уроки");
    const upcoming = [
      ...html.matchAll(
        /<li[^>]*data-roadmap-upcoming="([a-z]+)"[^>]*>(.*?)<\/li>/gu,
      ),
    ];
    expect(upcoming.map((match) => match[1])).toEqual(["writing", "soon"]);
    expect(upcoming[0]?.[2]).toContain("16");
    expect(upcoming[1]?.[2]).toContain("Урок, который скоро");
    expect(upcoming.some((match) => (match[2] ?? "").includes("<a"))).toBe(
      false,
    );
  });

  it("names the outcome of a planned chapter and keeps its topics as chips", () => {
    const html = render(true);
    expect(html).toContain("Пишем своего агента и встраиваем его в продукт.");
    expect(html).toContain('aria-label="Темы главы «Глава в планах»"');
    expect(html).toContain("<strong");
    expect(html).not.toContain("Материалы этой главы готовятся");
  });

  it("keeps the open chapters of today without a roadmap and shows an empty one as planned", () => {
    const html = render(false);
    expect(html).not.toContain('data-roadmap-chapter="done"');
    expect(html).not.toContain('data-roadmap-chapter="writing"');
    expect(html).not.toContain('data-roadmap-badge="writing"');
    expect(disclosure(html, "planned")).not.toMatch(/\sopen=""/u);
    expect(html).toContain('data-roadmap-badge="planned"');
    // The first batch of today stays: twelve lessons and the reveal button.
    expect(html.match(/data-route-material=/gu)).toHaveLength(12);
    expect(html).toContain("Показать ещё уроки");
  });
});
