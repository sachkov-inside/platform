import {
  createElement,
  isValidElement,
  type ComponentProps,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ProductJourney } from "@/_pages/library-discovery/ui/product-journey";
import type { ProductJourneyControls } from "@/_pages/library-discovery/ui/product-journey-controls.client";
import type { ProductChapterTask } from "@/entities/product-task";
import type { ProductChapter } from "@/features/library-discovery";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { productJourneyCorpus } from "@/storybook/product-journey-corpus.fixtures";

vi.mock("next/navigation", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

function task(
  code: string,
  afterMaterialId: string | null,
): ProductChapterTask {
  return {
    code,
    title: `Задание ${code}`,
    access: "free",
    afterMaterialId,
    availability: "available",
    lastSubmittedAt: null,
  };
}

const chapters: readonly ProductChapter[] = [
  {
    id: "chapter-1",
    name: "Первая глава",
    summary: "",
    materialIds: ["material-1", "material-2", "material-3"],
    supplementaryMaterialIds: ["material-4"],
    tasks: [task("lead", null), task("after-2", "material-2")],
  },
  {
    id: "chapter-2",
    name: "Пустая глава",
    summary: "Скоро",
    materialIds: [],
  },
  {
    id: "chapter-3",
    name: "Третья глава",
    summary: "",
    materialIds: ["material-5", "material-6"],
    supplementaryMaterialIds: ["material-7", "material-8"],
  },
  {
    id: "chapter-4",
    name: "Ещё одна пустая глава",
    summary: "",
    materialIds: [],
    supplementaryMaterialIds: ["material-9"],
  },
];

function placement(id: string, materialId: string, chapterId: string) {
  return { id, materialId, chapterId, stepGroup: null };
}

function journeyProps(
  result: Parameters<typeof ProductJourney>[0]["result"],
): ComponentProps<typeof ProductJourneyControls> {
  const journey: ReactElement<ComponentProps<typeof ProductJourneyControls>> =
    ProductJourney({
      currentHref: productProgrammeHref("platform-inside"),
      result,
    });
  return journey.props;
}

/**
 * Paths of keyless elements below an array in `ProductJourneyControls` props, excluding props of
 * other elements. The programme page reported such elements in React's development key warning
 * (#1802).
 */
function keylessListElements(
  value: unknown,
  path: string,
  inList: boolean,
): readonly string[] {
  if (isValidElement(value)) return inList && value.key === null ? [path] : [];
  if (Array.isArray(value))
    return value.flatMap((entry: unknown, index) =>
      keylessListElements(entry, `${path}[${String(index)}]`, true),
    );
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    keylessListElements(entry, `${path}.${key}`, inList),
  );
}

describe("Product programme elements handed to the client", () => {
  it("keys every element the server places in arrays of chapter runs", () => {
    const props = journeyProps({ ...productJourneyCorpus(), chapters });
    const runs = props.parts.flatMap((part) =>
      part.kind === "materials" ? part.runs : [],
    );
    expect(runs.map((run) => run.chapter?.id)).toEqual([
      "chapter-1",
      "chapter-2",
      "chapter-3",
      "chapter-4",
    ]);
    expect(runs.filter((run) => run.supplementary != null)).toHaveLength(4);
    expect(runs[0]?.leading).toBeDefined();
    expect(runs[0]?.rows.some((row) => row.after !== undefined)).toBe(true);

    expect(keylessListElements(props, "props", false)).toEqual([]);
  });

  it("keys placement cards when a chapter is split and a Material repeats", () => {
    const result = {
      ...productJourneyCorpus(),
      chapters,
      programmePlacements: [
        placement(
          "10000000-0000-4000-8000-000000000001",
          "material-1",
          "chapter-1",
        ),
        placement(
          "10000000-0000-4000-8000-000000000002",
          "material-2",
          "chapter-1",
        ),
        placement(
          "10000000-0000-4000-8000-000000000003",
          "material-1",
          "chapter-1",
        ),
        placement(
          "10000000-0000-4000-8000-000000000004",
          "material-5",
          "chapter-3",
        ),
        placement(
          "10000000-0000-4000-8000-000000000005",
          "material-3",
          "chapter-1",
        ),
      ],
    };
    const props = journeyProps(result);
    const runs = props.parts.flatMap((part) =>
      part.kind === "materials" ? part.runs : [],
    );
    expect(runs.map((run) => run.chapter?.id)).toEqual([
      "chapter-1",
      "chapter-2",
      "chapter-3",
      "chapter-1",
      "chapter-4",
    ]);
    expect(runs.map((run) => run.rows.map((row) => row.id))).toEqual([
      [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
        "10000000-0000-4000-8000-000000000003",
      ],
      [],
      ["10000000-0000-4000-8000-000000000004"],
      ["10000000-0000-4000-8000-000000000005"],
      [],
    ]);
    expect(runs.map((run) => run.leading !== undefined)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    const html = renderToStaticMarkup(
      createElement(ProductJourney, {
        currentHref: productProgrammeHref("platform-inside"),
        result,
      }),
    );
    const sections = [...html.matchAll(/<section([^>]*)>/gu)]
      .map((match) => match[1] ?? "")
      .filter((attributes) => attributes.includes('class="programme-chapter"'));
    expect(sections).toHaveLength(5);
    const ids = sections.map(
      (attributes) => / id="([^"]+)"/u.exec(attributes)?.[1],
    );
    expect(ids.every((id) => id !== undefined)).toBe(true);
    expect(new Set(ids).size).toBe(5);
    expect(
      sections.map(
        (attributes) => /aria-labelledby="([^"]+)"/u.exec(attributes)?.[1],
      ),
    ).toEqual([
      "chapter-chapter-1",
      "chapter-chapter-2",
      "chapter-chapter-3",
      "chapter-chapter-1",
      "chapter-chapter-4",
    ]);
    for (const chapter of chapters) {
      expect(
        html.match(new RegExp(`id="chapter-${chapter.id}"`, "gu")),
      ).toHaveLength(1);
    }
    expect(
      html.match(/aria-label="Дополнительные материалы главы /gu),
    ).toHaveLength(3);
    expect(
      [...html.matchAll(/data-programme-placement="([^"]+)"/gu)].map(
        (match) => match[1],
      ),
    ).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
      "10000000-0000-4000-8000-000000000004",
      "10000000-0000-4000-8000-000000000005",
    ]);
    for (const run of runs) {
      const cardKeys = run.rows.map((row) =>
        isValidElement(row.card) ? row.card.key : null,
      );
      expect(new Set(cardKeys).size).toBe(cardKeys.length);
    }

    expect(keylessListElements(props, "props", false)).toEqual([]);
  });
});
