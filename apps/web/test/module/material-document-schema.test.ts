import { addressableMaterialBlockTypes } from "@inside/material-blocks";
import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { materialEditorExtensions } from "@/widgets/material-authoring";

/** Node and mark shape a document may take, as comparable text. */
function documentShape(schema: Schema): readonly string[] {
  const attributeNames = (attributes: Record<string, unknown> | undefined) =>
    Object.keys(attributes ?? {})
      .sort()
      .join("+");
  return [
    ...Object.values(schema.nodes).map((type) =>
      [
        "node",
        type.name,
        type.spec.group ?? "",
        type.spec.content ?? "",
        attributeNames(type.spec.attrs),
      ].join(" "),
    ),
    ...Object.values(schema.marks).map((type) =>
      ["mark", type.name, attributeNames(type.spec.attrs)].join(" "),
    ),
  ].sort();
}

describe("Material document schema", () => {
  it("gives the editor the same document the server accepts", () => {
    expect(documentShape(getSchema(materialEditorExtensions))).toEqual(
      documentShape(materialDocumentSchemaV1),
    );
  });

  it("carries a stable node identity on every block the registry addresses", () => {
    const addressed = Object.values(materialDocumentSchemaV1.nodes)
      .filter((type) => type.spec.attrs?.nodeId !== undefined)
      .map((type) => type.name)
      .sort();
    expect(addressed).toEqual([...addressableMaterialBlockTypes].sort());
  });
});
