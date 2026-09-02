import type {
  JsonObject,
  JsonValue,
  MaterialBodyExtraction,
  MaterialBodyResourceSummary,
  MaterialBody,
  RenderedBlock,
  RenderedMark,
  RenderedMaterialBody,
  RenderedText,
} from "./material-body.js";

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function isArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function object(value: JsonValue | undefined, context: string): JsonObject {
  if (value === undefined || !isObject(value)) {
    throw new TypeError(`Expected ${context}`);
  }
  return value;
}

function array(value: JsonValue | undefined, context: string): readonly JsonValue[] {
  if (!isArray(value)) {
    throw new TypeError(`Expected ${context}`);
  }
  return value;
}

function string(value: JsonValue | undefined, context: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`Expected ${context}`);
  }
  return value;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function attributes(node: JsonObject): JsonObject {
  const value = node.attrs;
  return value === undefined ? {} : object(value, "node attributes");
}

function renderMark(value: JsonValue): RenderedMark {
  const mark = object(value, "mark");
  const type = string(mark.type, "mark type");
  switch (type) {
    case "bold":
    case "code":
    case "italic":
    case "strike":
      return { kind: type };
    case "link":
      return {
        kind: "link",
        href: string(attributes(mark).href, "link href"),
      };
    default:
      throw new TypeError(`Unsupported mark: ${type}`);
  }
}

function renderText(value: JsonValue): RenderedText {
  const node = object(value, "text node");
  if (node.type !== "text") {
    throw new TypeError("Expected text node");
  }
  return {
    kind: "text",
    text: string(node.text, "text"),
    marks: node.marks === undefined ? [] : array(node.marks, "marks").map(renderMark),
  };
}

function renderInlineContent(node: JsonObject): readonly RenderedText[] {
  return node.content === undefined
    ? []
    : array(node.content, "inline content").map(renderText);
}

function renderBlockContent(node: JsonObject): readonly RenderedBlock[] {
  return node.content === undefined
    ? []
    : array(node.content, "block content").map(renderBlock);
}

function renderList(node: JsonObject, kind: "bullet_list" | "ordered_list"): RenderedBlock {
  return {
    kind,
    items: array(node.content, "list items").map((value) => {
      const item = object(value, "list item");
      if (item.type !== "listItem") {
        throw new TypeError("Expected list item");
      }
      return renderBlockContent(item);
    }),
  };
}

function renderTable(node: JsonObject): RenderedBlock {
  return {
    kind: "table",
    rows: array(node.content, "table rows").map((rowValue) => {
      const row = object(rowValue, "table row");
      if (row.type !== "tableRow") {
        throw new TypeError("Expected table row");
      }
      return {
        cells: array(row.content, "table cells").map((cellValue) => {
          const cell = object(cellValue, "table cell");
          if (cell.type !== "tableCell" && cell.type !== "tableHeader") {
            throw new TypeError("Expected table cell");
          }
          return {
            header: cell.type === "tableHeader",
            content: renderBlockContent(cell),
          };
        }),
      };
    }),
  };
}

function renderBlock(value: JsonValue): RenderedBlock {
  const node = object(value, "block node");
  const type = string(node.type, "block type");
  const attrs = attributes(node);
  switch (type) {
    case "paragraph":
      return { kind: "paragraph", content: renderInlineContent(node) };
    case "heading": {
      const level = attrs.level;
      if (level !== 2 && level !== 3 && level !== 4) {
        throw new TypeError("Unsupported heading level");
      }
      return { kind: "heading", level, content: renderInlineContent(node) };
    }
    case "bulletList":
      return renderList(node, "bullet_list");
    case "orderedList":
      return renderList(node, "ordered_list");
    case "blockquote":
      return { kind: "blockquote", content: renderBlockContent(node) };
    case "codeBlock":
      return {
        kind: "code_block",
        text: renderInlineContent(node).map(({ text }) => text).join(""),
      };
    case "horizontalRule":
      return { kind: "horizontal_rule" };
    case "table":
      return renderTable(node);
    case "callout": {
      const tone = attrs.kind;
      if (tone !== "note" && tone !== "tip" && tone !== "warning") {
        throw new TypeError("Unsupported callout tone");
      }
      return { kind: "callout", tone, content: renderBlockContent(node) };
    }
    case "assetImage": {
      const caption = optionalString(attrs.caption);
      return {
        kind: "image",
        assetId: string(attrs.assetId, "asset ID"),
        alt: string(attrs.alt, "image alt"),
        ...(caption === undefined ? {} : { caption }),
      };
    }
    case "assetFile":
      return {
        kind: "file",
        assetId: string(attrs.assetId, "asset ID"),
        label: string(attrs.label, "file label"),
      };
    default:
      throw new TypeError(`Unsupported block: ${type}`);
  }
}

export function renderMaterialBody(
  document: MaterialBody,
): RenderedMaterialBody {
  if (document.doc.type !== "doc") {
    throw new TypeError("Expected document root");
  }
  return {
    schemaVersion: 1,
    blocks:
      document.doc.content === undefined
        ? []
        : array(document.doc.content, "document content").map(renderBlock),
  };
}

function inlineText(content: readonly RenderedText[]): string {
  return content.map(({ text }) => text).join("");
}

function blockText(block: RenderedBlock): string {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return inlineText(block.content);
    case "bullet_list":
    case "ordered_list":
      return block.items
        .map((item) => item.map(blockText).filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n");
    case "blockquote":
    case "callout":
      return block.content.map(blockText).filter(Boolean).join("\n\n");
    case "code_block":
      return block.text;
    case "horizontal_rule":
      return "";
    case "table":
      return block.rows
        .map((row) =>
          row.cells.map((cell) => cell.content.map(blockText).filter(Boolean).join(" ")).join("\t"),
        )
        .join("\n");
    case "image":
      return [block.alt, block.caption].filter(Boolean).join("\n");
    case "file":
      return block.label;
  }
}

function collect(
  block: RenderedBlock,
  headings: { level: 2 | 3 | 4; text: string }[],
  resources: MaterialBodyResourceSummary[],
): void {
  switch (block.kind) {
    case "heading":
      headings.push({ level: block.level, text: inlineText(block.content) });
      return;
    case "bullet_list":
    case "ordered_list":
      block.items.flat().forEach((child) => collect(child, headings, resources));
      return;
    case "blockquote":
    case "callout":
      block.content.forEach((child) => collect(child, headings, resources));
      return;
    case "table":
      block.rows.forEach((row) =>
        row.cells.forEach((cell) =>
          cell.content.forEach((child) => collect(child, headings, resources)),
        ),
      );
      return;
    case "image":
      resources.push({
        kind: "image",
        assetId: block.assetId,
        alt: block.alt,
        ...(block.caption === undefined ? {} : { caption: block.caption }),
      });
      return;
    case "file":
      resources.push({ assetId: block.assetId, kind: "file", label: block.label });
      return;
    case "paragraph":
    case "code_block":
    case "horizontal_rule":
      return;
  }
}

export function extractMaterialBody(
  document: RenderedMaterialBody,
): MaterialBodyExtraction {
  const headings: { level: 2 | 3 | 4; text: string }[] = [];
  const resources: MaterialBodyResourceSummary[] = [];
  document.blocks.forEach((block) => collect(block, headings, resources));
  return {
    plainText: document.blocks.map(blockText).filter(Boolean).join("\n\n"),
    headings,
    resources,
  };
}
