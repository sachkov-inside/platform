import type {
  MaterialBodyChange,
  JsonObject,
  JsonValue,
  MaterialBodyOperations,
  MaterialBodyResult,
  MaterialBody,
  MaterialBodySnapshot,
} from "./material-body.js";
import { assignMissingNodeIds } from "./assign-missing-node-ids.js";

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === "object";
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

interface TextNode extends JsonObject {
  readonly type: "text";
  readonly text: string;
}

function isTextNode(value: JsonValue): value is TextNode {
  return isJsonObject(value) && value.type === "text" && typeof value.text === "string";
}

function fail(index: number, code: string): MaterialBodyResult<never> {
  return {
    ok: false,
    error: {
      code: "invalid_content",
      issues: [{ code, path: `/changes/${index}` }],
    },
  };
}

function nodeId(block: unknown): string | undefined {
  if (!isJsonObject(block) || !isJsonObject(block.attrs)) {
    return undefined;
  }
  return typeof block.attrs.nodeId === "string" ? block.attrs.nodeId : undefined;
}

function withNodeId(
  block: unknown,
  stableNodeId?: string,
): JsonObject | undefined {
  if (block === null || Array.isArray(block) || typeof block !== "object") {
    return undefined;
  }
  let candidate: unknown;
  try {
    candidate = structuredClone(block);
  } catch {
    return undefined;
  }
  if (!isUnknownRecord(candidate)) {
    return undefined;
  }
  if (
    candidate.attrs !== undefined &&
    (candidate.attrs === null || Array.isArray(candidate.attrs) || typeof candidate.attrs !== "object")
  ) {
    return undefined;
  }
  assignMissingNodeIds(candidate, stableNodeId);
  return isJsonObject(candidate) ? candidate : undefined;
}

interface LocatedNode {
  readonly node: JsonObject;
  readonly siblings: unknown[];
  readonly index: number;
}

function mutableContent(node: unknown): unknown[] | undefined {
  if (!isUnknownRecord(node)) {
    return undefined;
  }
  return isUnknownArray(node.content) ? node.content : undefined;
}

function findNode(root: unknown, targetNodeId: string): LocatedNode | undefined {
  const content = mutableContent(root);
  if (content === undefined) {
    return undefined;
  }
  for (const [index, child] of content.entries()) {
    if (nodeId(child) === targetNodeId && isJsonObject(child)) {
      return { node: child, siblings: content, index };
    }
    const nested = findNode(child, targetNodeId);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function replaceText(
  block: JsonValue,
  change: Extract<MaterialBodyChange, { readonly kind: "replace_text" }>,
): JsonObject | undefined {
  if (!isJsonObject(block)) {
    return undefined;
  }
  const textNodes = block.content === undefined ? [] : block.content;
  if (
    !isJsonArray(textNodes) ||
    !textNodes.every(isTextNode)
  ) {
    return undefined;
  }
  const lengths = textNodes.map((node) => Array.from(node.text).length);
  const totalLength = lengths.reduce((total, length) => total + length, 0);
  if (
    !Number.isInteger(change.from) ||
    !Number.isInteger(change.to) ||
    change.from < 0 ||
    change.to < change.from ||
    change.to > totalLength
  ) {
    return undefined;
  }

  const nextContent: JsonObject[] = [];
  function append(node: JsonObject, text: string): void {
    if (text.length === 0) {
      return;
    }
    const candidate = { ...node, text };
    const previous = nextContent.at(-1);
    if (previous !== undefined) {
      const previousShape = { ...previous, text: "" };
      const candidateShape = { ...candidate, text: "" };
      if (JSON.stringify(previousShape) === JSON.stringify(candidateShape)) {
        nextContent[nextContent.length - 1] = {
          ...previous,
          text: `${typeof previous.text === "string" ? previous.text : ""}${text}`,
        };
        return;
      }
    }
    nextContent.push(candidate);
  }

  let offset = 0;
  let insertionTemplate: JsonObject | undefined;
  for (const [index, value] of textNodes.entries()) {
    const textNode = value;
    const text = Array.from(textNode.text);
    const end = offset + text.length;
    if (change.from < end || (change.from === totalLength && index === textNodes.length - 1)) {
      insertionTemplate ??= textNode;
    }
    if (offset < change.from) {
      append(textNode, text.slice(0, Math.min(text.length, change.from - offset)).join(""));
    }
    offset = end;
  }

  if (
    insertionTemplate === undefined &&
    textNodes.length === 0 &&
    typeof block.type === "string" &&
    ["paragraph", "heading", "codeBlock"].includes(block.type)
  ) {
    insertionTemplate = { type: "text" };
  }
  if (insertionTemplate === undefined) {
    return undefined;
  }
  append(insertionTemplate, change.text);

  offset = 0;
  for (const value of textNodes) {
    const textNode = value;
    const text = Array.from(textNode.text);
    const end = offset + text.length;
    if (end > change.to) {
      append(textNode, text.slice(Math.max(0, change.to - offset)).join(""));
    }
    offset = end;
  }

  const blockWithoutContent = Object.fromEntries(
    Object.entries(block).filter(([key]) => key !== "content"),
  );
  return nextContent.length === 0
    ? blockWithoutContent
    : { ...blockWithoutContent, content: nextContent };
}

export function applyMaterialBodyChanges(
  document: MaterialBodySnapshot,
  changes: readonly MaterialBodyChange[],
  acceptMaterialBody: MaterialBodyOperations["accept"],
): MaterialBodyResult<MaterialBody> {
  const accepted = acceptMaterialBody(document);
  if (!accepted.ok) {
    return accepted;
  }
  let current = accepted.value;

  for (const [index, change] of changes.entries()) {
    if (change.kind === "replace_document") {
      const replacement = acceptMaterialBody(change.document, { assignMissingNodeIds: true });
      if (!replacement.ok) {
        return replacement;
      }
      current = replacement.value;
      continue;
    }

    const document = structuredClone(current.doc);

    if (change.kind === "insert_blocks") {
      const location =
        change.afterNodeId === null ? undefined : findNode(document, change.afterNodeId);
      if (change.afterNodeId !== null && location === undefined) {
        return fail(index, "node_not_found");
      }
      const siblings = location?.siblings ?? mutableContent(document);
      if (siblings === undefined) {
        return fail(index, "invalid_document_structure");
      }
      const insertionIndex = location === undefined ? 0 : location.index + 1;
      const inserted = change.blocks.map((block) => withNodeId(block));
      if (inserted.some((block) => block === undefined)) {
        return fail(index, "invalid_block");
      }
      const validBlocks = inserted.filter(
        (block): block is JsonObject => block !== undefined,
      );
      siblings.splice(insertionIndex, 0, ...validBlocks);
    } else {
      const location = findNode(document, change.nodeId);
      if (location === undefined) {
        return fail(index, "node_not_found");
      }
      if (change.kind === "delete_block") {
        location.siblings.splice(location.index, 1);
      } else if (change.kind === "replace_block") {
        const replacement = withNodeId(change.block, change.nodeId);
        if (replacement === undefined) {
          return fail(index, "invalid_block");
        }
        location.siblings[location.index] = replacement;
      } else {
        const replacement = replaceText(location.node, change);
        if (replacement === undefined) {
          return fail(index, "invalid_text_range");
        }
        location.siblings[location.index] = replacement;
      }
    }

    const accepted = acceptMaterialBody({
      schemaVersion: 1,
      doc: document,
    });
    if (!accepted.ok) {
      return accepted;
    }
    current = accepted.value;
  }

  return { ok: true, value: current };
}
