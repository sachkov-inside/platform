import type { RenderedBlock } from "@inside/material-blocks";
import { describe, expect, test } from "vitest";

import {
  clampOpenedParts,
  lessonParts,
} from "../../src/entities/material/model/lesson-parts";

const paragraph = (text: string): RenderedBlock => ({
  kind: "paragraph",
  content: [{ kind: "text", text, marks: [] }],
});
const quiz = (id: string, reveal: "none" | "after-answer"): RenderedBlock => ({
  kind: "quiz",
  id,
  reveal,
  question: [paragraph("?")],
  selectionMode: "single",
  options: [
    { id: "a", content: [paragraph("A")], correct: true },
    { id: "b", content: [paragraph("B")], correct: false },
  ],
});

describe("lesson parts (#2122)", () => {
  test("a lesson without step breaks or «after answer» exercises is one part", () => {
    const parts = lessonParts([
      paragraph("one"),
      quiz("plain", "none"),
      paragraph("two"),
    ]);
    expect(parts.count).toBe(1);
    expect(parts.gates).toEqual([]);
    expect([0, 1, 2].map((index) => parts.partOf(index))).toEqual([0, 0, 0]);
  });

  test("a step break and an «after answer» exercise each end a part; the gate stays in the part it ends", () => {
    const parts = lessonParts([
      paragraph("intro"),
      { kind: "step_break", label: "Что дальше?" },
      paragraph("question"),
      quiz("check", "after-answer"),
      paragraph("explanation"),
      quiz("plain", "none"),
    ]);
    expect(parts.count).toBe(3);
    expect(parts.gates).toEqual([
      { at: 1, kind: "break", label: "Что дальше?" },
      { at: 3, kind: "exercise", exerciseId: "check" },
    ]);
    expect([0, 1, 2, 3, 4, 5].map((index) => parts.partOf(index))).toEqual([
      0, 0, 1, 1, 2, 2,
    ]);
  });

  test("a saved count opens at least the first part and never more parts than the lesson has now", () => {
    expect(clampOpenedParts(null, 3)).toBe(1);
    expect(clampOpenedParts(0, 3)).toBe(1);
    expect(clampOpenedParts(2, 3)).toBe(2);
    // A break the author removed since: the reader sees the whole lesson, not an error.
    expect(clampOpenedParts(7, 3)).toBe(3);
    expect(clampOpenedParts(2.5, 3)).toBe(2);
  });
});
