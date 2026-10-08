import { expect, it } from "vitest";

import {
  placeChapterTasks,
  type ProductChapterTask,
} from "@/entities/product-task.model";

function task(
  code: string,
  afterMaterialId: string | null,
): ProductChapterTask {
  return {
    code,
    title: code,
    access: "free",
    afterMaterialId,
    availability: "available",
    lastSubmittedAt: null,
  };
}

it("places tasks after their Material in author order and the rest at the start of the chapter", () => {
  const placed = placeChapterTasks(
    [
      task("opening", null),
      task("after-video", "video"),
      task("moved-away", "left-the-chapter"),
      task("also-after-video", "video"),
      task("after-theory", "theory"),
    ],
    ["video", "theory", "review"],
  );
  expect(placed.leading.map(({ code }) => code)).toEqual([
    "opening",
    "moved-away",
  ]);
  expect(
    Object.fromEntries(
      [...placed.after].map(([material, tasks]) => [
        material,
        tasks.map(({ code }) => code),
      ]),
    ),
  ).toEqual({
    video: ["after-video", "also-after-video"],
    theory: ["after-theory"],
  });
});
