import { describe, expect, test } from "vitest";
import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import { wrapIn } from "@tiptap/pm/commands";
import { EditorState, NodeSelection } from "@tiptap/pm/state";

describe("Video document editing", () => {
  test("starts and fills an empty document with a paragraph rather than an unsolicited video", () => {
    expect(
      materialDocumentSchemaV1.topNodeType.createAndFill()?.firstChild?.type
        .name,
    ).toBe("paragraph");
  });
  test("keeps video at the root when the author wraps a selected block", () => {
    const video = materialDocumentSchemaV1.node("video", {
      nodeId: "92000000-0000-4000-8000-000000000001",
    });
    const doc = materialDocumentSchemaV1.node("doc", null, [video]);
    const state = EditorState.create({
      schema: materialDocumentSchemaV1,
      doc,
      selection: NodeSelection.create(doc, 0),
    });
    const blockquote = materialDocumentSchemaV1.nodes["blockquote"];
    if (blockquote === undefined) throw new Error("Missing blockquote schema");
    expect(wrapIn(blockquote)(state)).toBe(false);
  });
});
