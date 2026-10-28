import { isValidElement, type ComponentProps, type ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { ProductJourney } from "@/_pages/library-discovery/ui/product-journey";
import type { ProductJourneyControls } from "@/_pages/library-discovery/ui/product-journey-controls.client";
import type { ProductChapterTask } from "@/entities/product-task";
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

/**
 * Every element the server places inside an array of `ProductJourneyControls` props. React in
 * development reports a keyless element passed this way as a list child of the client component.
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
  it("keys every rendered element inside the programme runs", () => {
    const corpus = productJourneyCorpus();
    const journey: ReactElement<ComponentProps<typeof ProductJourneyControls>> =
      ProductJourney({
        currentHref: productProgrammeHref("platform-inside"),
        result: {
          ...corpus,
          chapters: [
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
          ],
        },
      });
    const runs = journey.props.parts.flatMap((part) =>
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

    expect(keylessListElements(journey.props, "props", false)).toEqual([]);
  });
});
