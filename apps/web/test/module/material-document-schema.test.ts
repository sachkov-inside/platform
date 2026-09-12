import {
  addressableMaterialBlockTypes,
  isUnknownRecord,
  materialBlockDefinitions,
} from "@inside/material-blocks";
import type { JsonValue } from "@inside/material-blocks";
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

/** Значение, по которому видно, что поле вернулось тем же, каким ушло в разметку. */
function sampleField(defaultValue: JsonValue): JsonValue {
  return Array.isArray(defaultValue)
    ? [{ label: "Метка", name: "Название" }]
    : "Значение поля";
}

/** Атрибуты, которые `toDOM` записал на сам элемент. */
function renderedAttributes(rendered: unknown): Record<string, unknown> {
  if (!Array.isArray(rendered)) {
    throw new TypeError("Expected a DOM output spec");
  }
  const attributes: unknown = rendered[1];
  return isUnknownRecord(attributes) ? attributes : {};
}

describe("Material document DOM contract", () => {
  it("returns every field a block writes to its own DOM attribute", () => {
    const withDomFields = materialBlockDefinitions.filter(
      (definition) => definition.node?.domAttributes !== undefined,
    );
    expect(withDomFields.length).toBeGreaterThan(0);

    for (const definition of withDomFields) {
      const declaration = definition.node;
      if (declaration?.domAttributes === undefined) continue;
      const type = materialDocumentSchemaV1.nodes[definition.type];
      if (type === undefined) throw new TypeError(`Missing node ${definition.type}`);

      const fields = Object.fromEntries(
        Object.keys(declaration.domAttributes).map((name) => [
          name,
          sampleField(declaration.attributes[name] ?? null),
        ]),
      );
      const node = type.createAndFill(fields);
      if (node === null) throw new TypeError(`Cannot build ${definition.type}`);

      const attributes = renderedAttributes(type.spec.toDOM?.(node));
      // Буфер обмена собирает узел заново из разметки, поэтому поле обязано пройти оба конца.
      // Правило разбора читает только `getAttribute`, поэтому элемент здесь — этот один метод.
      const element = {
        getAttribute: (name: string) =>
          typeof attributes[name] === "string" ? attributes[name] : null,
      } as unknown as HTMLElement;
      const parsed = type.spec.parseDOM?.[0]?.getAttrs?.(element);

      expect([definition.type, parsed]).toEqual([
        definition.type,
        expect.objectContaining(fields),
      ]);
    }
  });
});

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
