import {
  keepFirstTermMentions,
  materialGlossaryTermIds,
  type RenderedBlock,
} from "@inside/material-blocks";
import { describe, expect, test } from "vitest";

import { materialBodyOperations } from "../../src/modules/materials/infrastructure/tiptap/index.js";

const node = (suffix: string) => `92000000-0000-4000-8000-0000000021${suffix}`;

function termText(text: string, termId: string) {
  return {
    type: "text",
    text,
    marks: [{ type: "link", attrs: { href: `term:${termId}` } }],
  };
}

function lesson(definitionTermId = "bounded-context") {
  return {
    schemaVersion: 1,
    doc: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { nodeId: node("01") },
          content: [
            { type: "text", text: "Граница " },
            termText("ограниченного контекста", "bounded-context"),
            { type: "text", text: " и " },
            termText("агрегат", "aggregate"),
          ],
        },
        {
          type: "termDefinition",
          attrs: { nodeId: node("02"), termId: definitionTermId },
        },
        {
          type: "callout",
          attrs: { nodeId: node("03"), kind: "note" },
          content: [
            {
              type: "paragraph",
              attrs: { nodeId: node("04") },
              content: [termText("контекст", "bounded-context")],
            },
          ],
        },
      ],
    },
  };
}

function rendered(source: unknown): readonly RenderedBlock[] {
  const accepted = materialBodyOperations.accept(source);
  if (!accepted.ok) throw new Error(JSON.stringify(accepted.error));
  const body = materialBodyOperations.render(accepted.value);
  if (!body.ok) throw new Error("Body must render");
  return body.value.blocks;
}

describe("Glossary Term references in a Material body", () => {
  test("accepts term links and a definition card and renders the card by its term", () => {
    const blocks = rendered(lesson());
    expect(blocks[0]).toMatchObject({
      kind: "paragraph",
      content: [
        { text: "Граница ", marks: [] },
        {
          text: "ограниченного контекста",
          marks: [{ kind: "link", href: "term:bounded-context" }],
        },
        { text: " и ", marks: [] },
        { text: "агрегат", marks: [{ kind: "link", href: "term:aggregate" }] },
      ],
    });
    expect(blocks[1]).toEqual({
      kind: "term_definition",
      termId: "bounded-context",
    });
  });

  test.each(["Bounded-Context", "bounded context", "", "-x"])(
    "refuses a term link to the malformed identifier %j",
    (termId) => {
      const source = lesson();
      source.doc.content[0]!.content![1] = termText("x", termId);
      expect(materialBodyOperations.accept(source)).toMatchObject({
        ok: false,
        error: { code: "invalid_content" },
      });
    },
  );

  test("refuses a definition card without a valid term identifier", () => {
    expect(materialBodyOperations.accept(lesson("Not A Term"))).toMatchObject({
      ok: false,
      error: {
        code: "invalid_content",
        issues: [
          { code: "invalid_term_id", path: "/doc/content/1/attrs/termId" },
        ],
      },
    });
  });

  test("names every referenced term once, in document order", () => {
    expect(materialGlossaryTermIds(rendered(lesson("domain-event")))).toEqual([
      "bounded-context",
      "aggregate",
      "domain-event",
    ]);
  });

  test("keeps the term link only on the first mention of each term", () => {
    const blocks = keepFirstTermMentions(rendered(lesson()));
    expect(blocks[0]).toEqual(rendered(lesson())[0]);
    expect(blocks[2]).toEqual({
      kind: "callout",
      tone: "note",
      content: [
        {
          kind: "paragraph",
          content: [{ kind: "text", text: "контекст", marks: [] }],
        },
      ],
    });
  });

  test("searches the term text but not the card, whose text lives in the Glossary", () => {
    const accepted = materialBodyOperations.accept(lesson());
    if (!accepted.ok) throw new Error("Body must be accepted");
    expect(materialBodyOperations.extract(accepted.value)).toMatchObject({
      ok: true,
      value: {
        plainText: "Граница ограниченного контекста и агрегат\n\nконтекст",
      },
    });
  });
});
