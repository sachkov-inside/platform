import { materialDocumentSchemaV1 } from "@inside/material-blocks/schema";
import type { Node } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";

import { blockMayHaveMoved } from "@/widgets/material-authoring";

const schema = materialDocumentSchemaV1;

function nodeType(name: string) {
  const type = schema.nodes[name];
  if (type === undefined) throw new Error(`В схеме документа нет узла «${name}»`);
  return type;
}

function paragraph(text: string) {
  return { content: [{ text, type: "text" }], type: "paragraph" };
}

/** Абзац, заголовок, карточка ресурса, абзац после неё и цитата с абзацем внутри. */
const document = schema.nodeFromJSON({
  content: [
    paragraph("Первый абзац"),
    { attrs: { level: 2 }, content: [{ text: "Заголовок", type: "text" }], type: "heading" },
    {
      attrs: { description: null, title: "Спецификация", url: "https://example.com/spec" },
      type: "resourceCard",
    },
    paragraph("Абзац после карточки"),
    { content: [paragraph("Цитата")], type: "blockquote" },
  ],
  type: "doc",
});

const [, heading, card, afterCard, quote] = [0, 1, 2, 3, 4];

/** Позиция начала блока верхнего уровня. */
function start(doc: Node, index: number): number {
  let offset = 0;
  for (let child = 0; child < index; child += 1) offset += doc.child(child).nodeSize;
  return offset;
}

function edit(change: (state: EditorState) => Transaction): Node {
  return change(EditorState.create({ doc: document, schema })).doc;
}

describe("Может ли блок под контролами сдвинуться", () => {
  it("не может, когда документ не менялся", () => {
    expect(blockMayHaveMoved(document, document, start(document, afterCard))).toBe(false);
  });

  it("не может, когда автор печатает внутри самого блока", () => {
    const next = edit((state) => state.tr.insertText("!", start(document, afterCard) + 3));
    expect(blockMayHaveMoved(document, next, start(next, afterCard))).toBe(false);
  });

  it("не может, когда меняются только атрибуты самого блока", () => {
    // Поля карточки пишутся в атрибуты на каждый знак, а верх карточки от них не зависит.
    const next = edit((state) =>
      state.tr.setNodeAttribute(start(document, card), "title", "Спецификация API"),
    );
    expect(blockMayHaveMoved(document, next, start(next, card))).toBe(false);
  });

  it("может, когда знак набран в блоке выше: строка там могла перенестись", () => {
    const next = edit((state) => state.tr.insertText("!", start(document, heading) + 3));
    expect(blockMayHaveMoved(document, next, start(next, afterCard))).toBe(true);
  });

  it("может, когда у блока выше сменились атрибуты", () => {
    const next = edit((state) =>
      state.tr.setNodeAttribute(start(document, card), "title", "Спецификация API"),
    );
    expect(blockMayHaveMoved(document, next, start(next, afterCard))).toBe(true);
  });

  it("может, когда перед блоком появился новый блок", () => {
    const next = edit((state) => state.tr.insert(0, nodeType("paragraph").create()));
    expect(blockMayHaveMoved(document, next, start(next, afterCard + 1))).toBe(true);
  });

  it("может, когда сменился тип самого блока", () => {
    const from = start(document, afterCard) + 1;
    const next = edit((state) =>
      state.tr.setBlockType(from, from, nodeType("heading"), { level: 2 }),
    );
    expect(blockMayHaveMoved(document, next, start(next, afterCard))).toBe(true);
  });

  it("может, когда внутри блока сменилось устройство, а не текст", () => {
    // Заголовок первой строкой цитаты сдвигает верх цитаты через схлопывание отступов.
    const from = start(document, quote) + 2;
    const next = edit((state) =>
      state.tr.setBlockType(from, from, nodeType("heading"), { level: 2 }),
    );
    expect(blockMayHaveMoved(document, next, start(next, quote))).toBe(true);
  });

  it("отвечает «может», когда позиция не на границе блока верхнего уровня", () => {
    const next = edit((state) => state.tr.insertText("!", start(document, afterCard) + 3));
    expect(blockMayHaveMoved(document, next, start(next, afterCard) + 1)).toBe(true);
  });
});
