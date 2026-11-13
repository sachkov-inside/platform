import { materialExerciseNumbers } from "@inside/material-blocks";
import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import { describe, expect, test } from "vitest";
import { materialBodyOperations } from "../../src/modules/materials/infrastructure/tiptap/index.js";

type Json = Record<string, unknown>;

const paragraph = (text: string) => ({
  kind: "paragraph",
  content: [{ kind: "text", text, marks: [] }],
});

function quiz(): Json {
  return {
    kind: "quiz",
    id: "rag-wrong-platform",
    reveal: "after-answer",
    context: [paragraph("Public context")],
    question: [paragraph("Public question")],
    selectionMode: "single",
    options: [
      {
        id: "embed",
        content: [paragraph("Embedding")],
        correct: false,
        explanation: [paragraph("Wrong explanation")],
      },
      { id: "prompt", content: [paragraph("Prompt")], correct: true },
    ],
    dontKnow: {
      explanation: [paragraph("Review explanation")],
      reviewLinks: ["#section"],
    },
  };
}

function match(): Json {
  return {
    kind: "match",
    id: "roles",
    reveal: "none",
    question: [paragraph("Match question")],
    mode: "pairs",
    rows: ["plan", "code", "test"].map((id) => ({
      id,
      content: [paragraph(`Row ${id}`)],
      answerId: `${id}-role`,
      explanation: [paragraph(`Why ${id}`)],
    })),
    choices: ["plan", "code", "test"].map((id) => ({
      id: `${id}-role`,
      content: [paragraph(`Choice ${id}`)],
    })),
  };
}

function order(): Json {
  return {
    kind: "order",
    id: "pipeline",
    reveal: "none",
    question: [paragraph("Order question")],
    steps: ["spec", "code", "ship"].map((id) => ({
      id,
      content: [paragraph(`Step ${id}`)],
      explanation: [paragraph(`Why ${id} here`)],
    })),
  };
}

function items(value: Json, key: string): Json[] {
  const list = value[key];
  if (!Array.isArray(list)) throw new Error(`Missing ${key}`);
  return list.map((item: unknown) => {
    if (typeof item !== "object" || item === null)
      throw new Error("Not an item");
    return { ...item };
  });
}

function document(...blocks: Json[]) {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { nodeId: "92000000-0000-4000-8000-000000001284", level: 2 },
          content: [{ type: "text", text: "Section" }],
        },
        ...blocks.map((block, index) => {
          const nodeId = `92000000-0000-4000-8000-00000000130${String(index)}`;
          return block["kind"] === "step_break"
            ? { type: "stepBreak", attrs: { nodeId, label: block["label"] } }
            : {
                type: String(block["kind"]),
                attrs: { nodeId, exercise: block },
              };
        }),
      ],
    },
  };
}

function rejects(...blocks: Json[]) {
  expect(materialBodyOperations.accept(document(...blocks))).toMatchObject({
    ok: false,
  });
}

describe("Lesson Exercise registry blocks", () => {
  test("keep quiz, match, order and a step break whole through accept, render and editor roundtrip", () => {
    const source = document(
      quiz(),
      { kind: "step_break", label: "Что дальше?" },
      match(),
      order(),
    );
    const accepted = materialBodyOperations.accept(source);
    if (!accepted.ok) throw new Error(JSON.stringify(accepted.error));
    const rendered = materialBodyOperations.render(accepted.value);
    if (!rendered.ok) throw new Error("Exercises must render");
    expect(rendered.value.blocks.slice(1)).toEqual([
      quiz(),
      { kind: "step_break", label: "Что дальше?" },
      match(),
      order(),
    ]);
    expect(materialDocumentSchemaV1.nodeFromJSON(source.doc).toJSON()).toEqual(
      source.doc,
    );
  });

  test("search sees only the condition and the question of an exercise", () => {
    const accepted = materialBodyOperations.accept(
      document(
        quiz(),
        match(),
        { kind: "step_break", label: "Дальше" },
        order(),
      ),
    );
    if (!accepted.ok) throw new Error("Must accept");
    expect(materialBodyOperations.extract(accepted.value)).toMatchObject({
      ok: true,
      value: {
        plainText:
          "Section\n\nPublic context\n\nPublic question\n\nMatch question\n\nOrder question",
      },
    });
  });

  test("numbers exercises in lesson order and skips other blocks", () => {
    const accepted = materialBodyOperations.accept(
      document(
        quiz(),
        { kind: "step_break", label: "Дальше" },
        match(),
        order(),
      ),
    );
    if (!accepted.ok) throw new Error("Must accept");
    const rendered = materialBodyOperations.render(accepted.value);
    if (!rendered.ok) throw new Error("Must render");
    expect([...materialExerciseNumbers(rendered.value.blocks)]).toEqual([
      ["rag-wrong-platform", { number: 1, total: 3 }],
      ["roles", { number: 2, total: 3 }],
      ["pipeline", { number: 3, total: 3 }],
    ]);
  });

  test("rejects a quiz without a correct option", () => {
    const value = quiz();
    value["options"] = items(value, "options").map((option) => ({
      ...option,
      correct: false,
      explanation: [paragraph("x")],
    }));
    rejects(value);
  });

  test("rejects a single-answer quiz with two correct options", () => {
    const value = quiz();
    value["options"] = [
      ...items(value, "options").map((option) => ({
        ...option,
        correct: true,
      })),
      {
        id: "third",
        content: [paragraph("Third")],
        correct: false,
        explanation: [paragraph("x")],
      },
    ];
    rejects(value);
  });

  test("rejects a wrong quiz option without an explanation", () => {
    const value = quiz();
    const [first, second] = items(value, "options");
    const { explanation: _explanation, ...bare } = first ?? {};
    value["options"] = [bare, second];
    rejects(value);
  });

  test.each([
    ["legacy quiz key", { correctOptionId: "prompt" }],
    ["uppercase id", { id: "Rag" }],
    ["unknown reveal", { reveal: "always" }],
  ])("rejects a quiz with %s", (_name, patch) => {
    rejects({ ...quiz(), ...patch });
  });

  test("rejects an item id repeated inside one exercise", () => {
    const value = match();
    const choices = items(value, "choices");
    const rows = items(value, "rows");
    choices[0] = { id: "plan", content: [paragraph("c")] };
    rows[0] = { ...rows[0], answerId: "plan" };
    rejects({ ...value, choices, rows });
  });

  test("rejects pairs where one choice answers two rows", () => {
    const value = match();
    const rows = items(value, "rows");
    rows[1] = { ...rows[1], answerId: "plan-role" };
    rejects({ ...value, rows });
  });

  test("accepts groups where a group holds several rows and rejects one row per group", () => {
    const groups = (answers: readonly string[]) => {
      const value = match();
      return {
        ...value,
        mode: "groups",
        rows: items(value, "rows").map((row, index) => ({
          ...row,
          answerId: answers[index],
        })),
        choices: [
          { id: "left", content: [paragraph("A")] },
          { id: "right", content: [paragraph("B")] },
        ],
      };
    };
    expect(
      materialBodyOperations.accept(document(groups(["left", "left", "right"])))
        .ok,
    ).toBe(true);
    rejects(groups(["left", "left", "left"]));
  });

  test("rejects an order with two steps", () => {
    const value = order();
    rejects({ ...value, steps: items(value, "steps").slice(0, 2) });
  });

  test("rejects an exercise nested inside another", () => {
    rejects({ ...order(), question: [match()] });
  });

  test("rejects two exercises with one id", () => {
    rejects(order(), { ...match(), id: "pipeline" });
  });

  test("rejects a blank step break label", () => {
    rejects(order(), { kind: "step_break", label: " " });
  });

  test("rejects a «Не знаю» link to an absent narrative heading", () => {
    rejects({
      ...quiz(),
      dontKnow: {
        explanation: [paragraph("x")],
        reviewLinks: ["#missing"],
      },
    });
  });

  test("rejects an unsafe link hidden inside a row explanation", () => {
    const value = match();
    const rows = items(value, "rows");
    rows[0] = {
      ...rows[0],
      explanation: [
        {
          kind: "paragraph",
          content: [
            {
              kind: "text",
              text: "Unsafe",
              marks: [{ kind: "link", href: "javascript:alert(1)" }],
            },
          ],
        },
      ],
    };
    rejects({ ...value, rows });
  });

  test.each(["/relative", "https://example.com/resource"])(
    "exercise resource cards use the registry https policy: %s",
    (url) => {
      const value = order();
      const steps = items(value, "steps");
      steps[0] = {
        ...steps[0],
        explanation: [{ kind: "resource_card", title: "Resource", url }],
      };
      expect(
        materialBodyOperations.accept(document({ ...value, steps })).ok,
      ).toBe(url.startsWith("https:"));
    },
  );
});
