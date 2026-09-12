import {
  addressableMaterialBlockTypes,
  isUnknownRecord,
  materialBlockDefinitions,
} from "@inside/material-blocks";
import type {
  JsonValue,
  MaterialBlockChildNodeDescription,
} from "@inside/material-blocks";
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

/**
 * Каждый объявленный реестром узел: сам блок и дочерние узлы, из которых он собирает своё
 * содержимое. Дочерний узел проходит через буфер обмена тем же путём и теряет поле так же.
 */
function declaredNodes(): readonly {
  readonly declaration: MaterialBlockChildNodeDescription;
  readonly type: string;
}[] {
  return materialBlockDefinitions.flatMap((definition) => {
    const declaration = definition.node;
    return declaration === undefined
      ? []
      : [
          { declaration, type: definition.type },
          ...Object.entries(declaration.childNodes ?? {}).map(
            ([type, child]) => ({ declaration: child, type }),
          ),
        ];
  });
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
    const withDomFields = declaredNodes().filter(
      ({ declaration }) => declaration.domAttributes !== undefined,
    );
    expect(withDomFields.length).toBeGreaterThan(0);

    for (const { declaration, type: name } of withDomFields) {
      if (declaration.domAttributes === undefined) continue;
      const type = materialDocumentSchemaV1.nodes[name];
      if (type === undefined) throw new TypeError(`Missing node ${name}`);

      const fields = Object.fromEntries(
        Object.keys(declaration.domAttributes).map((field) => [
          field,
          sampleField(declaration.attributes[field] ?? null),
        ]),
      );
      const node = type.createAndFill(fields);
      if (node === null) throw new TypeError(`Cannot build ${name}`);

      const attributes = renderedAttributes(type.spec.toDOM?.(node));
      // Буфер обмена собирает узел заново из разметки, поэтому поле обязано пройти оба конца.
      // Правило разбора читает только `getAttribute`, поэтому элемент здесь — этот один метод.
      const element = {
        getAttribute: (attribute: string) =>
          typeof attributes[attribute] === "string" ? attributes[attribute] : null,
      } as unknown as HTMLElement;
      const parsed = type.spec.parseDOM?.[0]?.getAttrs?.(element);

      expect([name, parsed]).toEqual([name, expect.objectContaining(fields)]);
    }
  });
});

describe("Material block child nodes", () => {
  const childNodeTypes = materialBlockDefinitions.flatMap((definition) =>
    Object.keys(definition.node?.childNodes ?? {}),
  );

  it("declares a child node the document schema knows", () => {
    expect(childNodeTypes.length).toBeGreaterThan(0);
    for (const name of childNodeTypes) {
      expect([name, materialDocumentSchemaV1.nodes[name]?.name]).toEqual([
        name,
        name,
      ]);
    }
  });

  it("keeps a child node out of the block group, so only its own block contains it", () => {
    for (const name of childNodeTypes) {
      const type = materialDocumentSchemaV1.nodes[name];
      if (type === undefined) throw new TypeError(`Missing node ${name}`);
      expect([name, type.spec.group]).toEqual([name, undefined]);
      // Негативная проверка правила: узел без группы не может стоять в документе сам по себе.
      const child = type.createAndFill();
      if (child === null) throw new TypeError(`Cannot build ${name}`);
      expect(() =>
        materialDocumentSchemaV1.nodes.doc?.createChecked(null, child),
      ).toThrow();
    }
  });

  it("leaves a child node unaddressed: progress and bookmarks hold the block around it", () => {
    for (const name of childNodeTypes) {
      expect([name, addressableMaterialBlockTypes.includes(name)]).toEqual([
        name,
        false,
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
