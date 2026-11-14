import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LessonSteps } from "@/entities/material";
import { MaterialBodyView } from "@/entities/material/ui/material-body-view";
import type { RenderedBlock } from "@/entities/material.model";

const paragraph = (text: string): RenderedBlock => ({
  kind: "paragraph",
  content: [{ kind: "text", text, marks: [] }],
});
const blocks: RenderedBlock[] = [
  paragraph("Первая часть."),
  { kind: "step_break", label: "А что дальше?" },
  paragraph("Вторая часть."),
  {
    kind: "quiz",
    id: "check",
    reveal: "after-answer",
    question: [paragraph("Вопрос?")],
    selectionMode: "single",
    options: [
      { id: "a", content: [paragraph("Да")], correct: true },
      {
        id: "b",
        content: [paragraph("Нет")],
        correct: false,
        explanation: [paragraph("Не так.")],
      },
    ],
  },
  paragraph("Разбор после ответа."),
];
const body = createElement(MaterialBodyView, {
  blocks,
  path: [],
  rendering: {
    headingId: () => "section",
    image: () => null,
    file: () => null,
  },
});

function cuts(html: string): { part: string; closed: boolean }[] {
  return [...html.matchAll(/<span[^>]*data-lesson-part="(\d+)"[^>]*>/gu)].map(
    ([tag, part = ""]) => ({ part, closed: tag.includes("data-closed") }),
  );
}

describe("step-by-step lesson in the server markup (#2122)", () => {
  it("carries the whole text and closes every part after the first until scripts open them", () => {
    const html = renderToStaticMarkup(
      createElement(LessonSteps, {
        blocks,
        progress: { saved: 3, save: () => undefined },
        reader: { name: "Вы", avatar: null },
        children: body,
      }),
    );
    for (const text of [
      "Первая часть.",
      "Вторая часть.",
      "Вопрос?",
      "Разбор после ответа.",
    ])
      expect(html).toContain(text);
    // The saved progress is the browser's to apply: the server and hydration agree on one part.
    expect(cuts(html)).toEqual([
      { part: "1", closed: true },
      { part: "2", closed: true },
    ]);
    expect(html).toContain("А что дальше?");
    expect(html).toContain("Пропустить");
  });

  it("leaves a body without the Reader's step state whole and without buttons", () => {
    const html = renderToStaticMarkup(body);
    expect(cuts(html)).toEqual([
      { part: "1", closed: false },
      { part: "2", closed: false },
    ]);
    expect(html).not.toContain("А что дальше?");
    expect(html).not.toContain("Пропустить");
  });
});
