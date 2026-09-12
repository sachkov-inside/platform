import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import { NodeSelection, TextSelection, EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { variantUnderCursor } from "@/widgets/material-authoring";

function branch(mode: string, text: string) {
  return {
    attrs: { mode },
    content: [
      { content: [{ text, type: "text" }], type: "paragraph" },
    ],
    type: "variantOption",
  };
}

/** Урок из одного вариантного шага с двумя ветками. */
const document = materialDocumentSchemaV1.nodeFromJSON({
  content: [
    {
      content: [branch("example", "На образце"), branch("own", "У себя")],
      type: "variant",
    },
  ],
  type: "doc",
});

function stateAt(select: (state: EditorState) => EditorState["selection"]) {
  const initial = EditorState.create({ doc: document, schema: materialDocumentSchemaV1 });
  return initial.apply(initial.tr.setSelection(select(initial)));
}

/** Позиции обеих веток в документе, в порядке документа. */
const [firstBranch, secondBranch] = (() => {
  const positions: number[] = [];
  document.child(0).forEach((_child, offset) => {
    positions.push(1 + offset);
  });
  return positions;
})();

describe("Ветка вариантного шага под курсором", () => {
  it("находит ветку, внутри которой стоит текстовый курсор", () => {
    for (const position of [firstBranch, secondBranch]) {
      const state = stateAt((current) =>
        TextSelection.create(current.doc, (position ?? 0) + 2),
      );
      expect(variantUnderCursor(state)?.currentBranch).toBe(position);
    }
  });

  it("не отдаёт соседнюю ветку, когда выделен сам узел ветки", () => {
    // Выделение целого узла стоит ровно на границе двух веток: отрезок отдал бы предыдущую,
    // и автор получил бы две ветки одного режима — материал, который перестал бы сохраняться.
    const state = stateAt((current) =>
      NodeSelection.create(current.doc, secondBranch ?? 0),
    );
    expect(variantUnderCursor(state)?.currentBranch).toBe(secondBranch);
  });

  it("видит обе ветки и конец блока", () => {
    const state = stateAt((current) =>
      TextSelection.create(current.doc, (firstBranch ?? 0) + 2),
    );
    const variant = variantUnderCursor(state);
    expect(variant?.branchPositions).toEqual([firstBranch, secondBranch]);
    expect(variant?.end).toBe(document.child(0).nodeSize - 1);
  });

  it("молчит вне вариантного шага", () => {
    const plain = materialDocumentSchemaV1.nodeFromJSON({
      content: [{ content: [{ text: "Обычный абзац", type: "text" }], type: "paragraph" }],
      type: "doc",
    });
    const state = EditorState.create({ doc: plain, schema: materialDocumentSchemaV1 });
    expect(variantUnderCursor(state)).toBeUndefined();
  });
});
