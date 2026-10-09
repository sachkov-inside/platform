import { describe, expect, test } from "vitest";
import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import { materialBodyOperations } from "../../src/modules/materials/infrastructure/tiptap/index.js";

function fixture() {
  const paragraph = (text: string) => ({
    kind: "paragraph",
    content: [{ kind: "text", text, marks: [] }],
  });
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "quiz",
          attrs: {
            nodeId: "92000000-0000-4000-8000-000000001283",
            quiz: {
              kind: "quiz",
              id: "question-1",
              prompt: [paragraph("Public question")],
              correctOptionId: "second",
              options: [
                {
                  id: "first",
                  content: [paragraph("First option")],
                  explanation: [paragraph("Wrong explanation")],
                },
                {
                  id: "second",
                  content: [paragraph("Second option")],
                  explanation: [paragraph("Correct explanation")],
                },
              ],
              dontKnow: {
                explanation: [paragraph("Review explanation")],
                reviewLinks: ["#section"],
              },
            },
          },
        },
      ],
    },
  };
}

describe("MaterialBody quiz registry", () => {
  test("keeps the full quiz through editor JSON roundtrip while search extracts only its question", () => {
    const source = fixture();
    const accepted = materialBodyOperations.accept(source);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error("Quiz must be accepted");
    const rendered = materialBodyOperations.render(accepted.value);
    const extracted = materialBodyOperations.extract(accepted.value);
    expect(extracted).toMatchObject({
      ok: true,
      value: { plainText: "Public question" },
    });
    if (!rendered.ok) throw new Error("Quiz must render");
    expect(rendered.value.blocks[0]).toEqual(source.doc.content[0]?.attrs.quiz);
    const reopened: unknown = materialDocumentSchemaV1
      .nodeFromJSON(source.doc)
      .toJSON();
    expect(reopened).toEqual(source.doc);
  });
  test.each([
    "invalid-key",
    "duplicate-id",
    "missing-explanation",
    "unknown-part",
  ])("rejects malformed quiz: %s", (scenario) => {
    const source = fixture();
    const quiz = source.doc.content[0]?.attrs.quiz;
    if (quiz === undefined) throw new Error("Fixture quiz missing");
    if (scenario === "invalid-key") quiz.correctOptionId = "missing";
    const first = quiz.options[0];
    const second = quiz.options[1];
    if (first === undefined || second === undefined)
      throw new Error("Missing options");
    if (scenario === "duplicate-id") second.id = "first";
    if (scenario === "missing-explanation") first.explanation = [];
    const candidate =
      scenario === "unknown-part" ? { ...quiz, analytics: true } : quiz;
    const node = source.doc.content[0];
    if (node === undefined) throw new Error("Missing quiz node");
    node.attrs.quiz = candidate;
    expect(materialBodyOperations.accept(source)).toMatchObject({ ok: false });
  });
});
