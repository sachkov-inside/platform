import type { MaterialBlockRenderTools } from "./block-definition.js";
import {
  expectArray,
  expectObject,
  expectString,
  nodeAttributes,
} from "./document-node.js";
import type { JsonObject, JsonValue } from "./json.js";
import { materialBlockByType } from "./registry.js";
import type { RenderedBlock, RenderedMark, RenderedText } from "./rendered-block.js";

function renderMark(value: JsonValue): RenderedMark {
  const mark = expectObject(value, "mark");
  const type = expectString(mark.type, "mark type");
  switch (type) {
    case "bold":
    case "code":
    case "italic":
    case "strike":
      return { kind: type };
    case "link":
      return {
        href: expectString(nodeAttributes(mark).href, "link href"),
        kind: "link",
      };
    default:
      throw new TypeError(`Unsupported mark: ${type}`);
  }
}

function renderText(value: JsonValue): RenderedText {
  const node = expectObject(value, "text node");
  if (node.type !== "text") {
    throw new TypeError("Expected text node");
  }
  return {
    kind: "text",
    marks:
      node.marks === undefined
        ? []
        : expectArray(node.marks, "marks").map(renderMark),
    text: expectString(node.text, "text"),
  };
}

function inlineContent(node: JsonObject): readonly RenderedText[] {
  return node.content === undefined
    ? []
    : expectArray(node.content, "inline content").map(renderText);
}

function blockContent(node: JsonObject): readonly RenderedBlock[] {
  return node.content === undefined
    ? []
    : renderMaterialBlocks(expectArray(node.content, "block content"));
}

const tools: MaterialBlockRenderTools = { blockContent, inlineContent };

/** Turns one accepted document node into its rendered block. */
export function renderMaterialBlock(value: JsonValue): RenderedBlock {
  const node = expectObject(value, "block node");
  const type = expectString(node.type, "block type");
  const definition = materialBlockByType(type);
  if (definition === undefined) {
    throw new TypeError(`Unsupported block: ${type}`);
  }
  return definition.render(node, tools);
}

export function renderMaterialBlocks(
  nodes: readonly JsonValue[],
): readonly RenderedBlock[] {
  return nodes.map(renderMaterialBlock);
}
