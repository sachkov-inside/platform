import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductJourney } from "@/_pages/library-discovery/ui/product-journey";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { productJourneyCorpus } from "@/storybook/product-journey-corpus.fixtures";

const navigation = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ refresh: vi.fn() }),
}));

beforeEach(() => {
  navigation.search = "part=materials";
});

function renderCatalogue(
  result: ReturnType<typeof productJourneyCorpus> = productJourneyCorpus(),
) {
  return renderToString(
    createElement(ProductJourney, {
      currentHref: productProgrammeHref("platform-inside"),
      result,
    }),
  );
}

function shelfTitles(html: string): string[] {
  return [...html.matchAll(/data-catalog-shelf="([^"]+)"/gu)].map(
    (match) => match[1] ?? "",
  );
}

/** The markup of one catalogue card, found by its Material slug. */
function cardHtml(html: string, slug: string): string {
  const start = html.indexOf(`data-material-slug="${slug}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</article>", start));
}

/** Visible and screen-reader text of a fragment, without tags. */
function textOf(fragment: string): string {
  return fragment
    .replace(/<!-- -->/gu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ");
}

const designTopic = "2a000000-0000-4000-8000-000000000001";
const reviewTopic = "2a000000-0000-4000-8000-000000000002";
const emptyTopic = "2a000000-0000-4000-8000-000000000003";

function corpusWithTopics() {
  return {
    ...productJourneyCorpus(),
    catalogueTopics: [
      {
        id: reviewTopic,
        name: "Ревью и замечания",
        summary: "",
        materialIds: ["material-4", "material-3"],
      },
      {
        id: emptyTopic,
        name: "Пустая тема",
        summary: "",
        materialIds: [],
      },
      {
        id: designTopic,
        name: "Дизайн с агентами",
        summary: "Макеты и прототипы",
        materialIds: ["material-1", "material-2"],
      },
    ],
  };
}

describe("Product catalogue presentation", () => {
  it("shows every Material of a Product without topics in one list", () => {
    const html = renderCatalogue();
    expect(html.match(/data-material-variant="library"/gu)).toHaveLength(120);
    expect(html).toContain("Все материалы");
    expect(html).not.toContain("Показать ещё материалы");
  });

  it("orders topic shelves as the author did and ends with Materials without a topic", () => {
    const html = renderCatalogue(corpusWithTopics());
    expect(shelfTitles(html)).toEqual([
      "Ревью и замечания",
      "Дизайн с агентами",
      "Другие материалы",
    ]);
    expect(html).not.toContain("Пустая тема");
  });

  it("names a Material without a cover once, on its title card", () => {
    const html = renderCatalogue(corpusWithTopics());
    expect(html.match(/>Урок 1<\/a>/gu)).toHaveLength(1);
    expect(html).toContain("data-library-title-card");
  });

  it("spells out on every card whether the Material is a video or a text", () => {
    const corpus = productJourneyCorpus();
    const html = renderCatalogue({
      ...corpus,
      items: [
        {
          ...corpus.items[1]!,
          slug: "grilling",
          title: "Проектирование через grilling",
          format: "Гайд",
          formatSlug: "guide",
          primaryVideoDurationSeconds: 1420,
        },
        { ...corpus.items[3]!, slug: "harness", title: "Улучшение harness" },
      ],
    });
    const video = cardHtml(html, "grilling");
    expect(textOf(video)).toContain("Видео · 23:40");
    expect(textOf(video)).not.toContain("Гайд");
    expect(video).toContain("data-library-play");
    const text = cardHtml(html, "harness");
    expect(textOf(text)).toContain("Текст");
    expect(textOf(text)).not.toContain("Гайд");
    expect(text).not.toContain("data-library-play");
  });

  it("keeps the catalogue return address of a card", () => {
    navigation.search = "part=materials&at=material-89";
    const html = renderCatalogue();
    expect(html).toContain('data-route-material="material-89"');
    expect(html).toContain("part%3Dmaterials%26at%3Dmaterial-89");
  });
});
