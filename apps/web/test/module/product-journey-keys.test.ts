import { isValidElement, type ComponentProps, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { ProductJourney } from "@/_pages/library-discovery/ui/product-journey";
import type { ProductJourneyControls } from "@/_pages/library-discovery/ui/product-journey-controls.client";
import type { ProductChapterTask } from "@/entities/product-task";
import type { ProductChapter } from "@/features/library-discovery";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { productJourneyCorpus } from "@/storybook/product-journey-corpus.fixtures";

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
 * Paths of keyless elements nested anywhere below an array in `ProductJourneyControls` props.
 * The programme page reported such elements in React's development key warning (#1802).
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
    const props = journeyProps({
      ...productJourneyCorpus(),
      chapters,
      programmePlacements: [
        ["placement-1", "material-1", "chapter-1"],
        ["placement-2", "material-5", "chapter-3"],
        ["placement-3", "material-2", "chapter-1"],
        ["placement-4", "material-1", "chapter-1"],
      ].map(([id = "", materialId = "", chapterId = null]) => ({
        id,
        materialId,
        chapterId,
        stepGroup: null,
      })),
    });
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
    expect(runs.flatMap((run) => run.rows.map((row) => row.id))).toEqual([
      "placement-1",
      "placement-2",
      "placement-3",
      "placement-4",
    ]);

    expect(keylessListElements(props, "props", false)).toEqual([]);
  });
});
