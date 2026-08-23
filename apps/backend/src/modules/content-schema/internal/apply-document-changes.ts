import { randomUUID } from "node:crypto";

import type {
  ContentSchemaResult,
  DocumentChange,
  JsonObject,
  JsonValue,
  MaterialDocumentV1,
} from "../content-schema.interface.js";
import { acceptDocument } from "./accept-document.js";
import { addressableBlockTypes } from "./schema-v1.js";

const addressableBlockTypeSet = new Set<string>(addressableBlockTypes);

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && value !== undefined && !Array.isArray(value) && typeof value === "object";
}

function fail(index: number, code: string): ContentSchemaResult<never> {
  return {
    ok: false,
    error: {
      code: "invalid_content",
      issues: [{ code, path: `/changes/${index}` }],
    },
  };
}

function nodeId(block: JsonValue): string | undefined {
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
  const candidate = structuredClone(block) as Record<string, unknown>;
  if (
    candidate.attrs !== undefined &&
    (candidate.attrs === null || Array.isArray(candidate.attrs) || typeof candidate.attrs !== "object")
  ) {
    return undefined;
  }
  function assignMissingNodeIds(value: unknown, rootNodeId?: string): void {
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      if (Array.isArray(value)) {
        value.forEach((child) => assignMissingNodeIds(child));
      }
      return;
    }
    const node = value as Record<string, unknown>;
    if (typeof node.type === "string" && addressableBlockTypeSet.has(node.type)) {
      if (
        node.attrs !== undefined &&
        (node.attrs === null || Array.isArray(node.attrs) || typeof node.attrs !== "object")
      ) {
        return;
      }
      const attributes = { ...(node.attrs ?? {}) } as Record<string, unknown>;
      if (rootNodeId !== undefined || typeof attributes.nodeId !== "string") {
        attributes.nodeId = rootNodeId ?? randomUUID();
      }
      node.attrs = attributes;
    }
    if (Array.isArray(node.content)) {
      node.content.forEach((child) => assignMissingNodeIds(child));
    }
  }

  assignMissingNodeIds(candidate, stableNodeId);
  return candidate as JsonObject;
}

function contentBlocks(document: MaterialDocumentV1): JsonValue[] | undefined {
  const content = document.doc.content;
  return Array.isArray(content) ? structuredClone(content) : undefined;
}

function replaceText(
  block: JsonValue,
  change: Extract<DocumentChange, { readonly kind: "replace_text" }>,
): JsonObject | undefined {
  if (!isJsonObject(block) || !Array.isArray(block.content)) {
    return undefined;
  }
  const textNodes = block.content;
  if (
    textNodes.length === 0 ||
    textNodes.some(
      (node) => !isJsonObject(node) || node.type !== "text" || typeof node.text !== "string",
    )
  ) {
    return undefined;
  }
  const lengths = textNodes.map((node) =>
    isJsonObject(node) && typeof node.text === "string" ? [...node.text].length : 0,
  );
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
          text: `${String(previous.text)}${text}`,
        };
        return;
      }
    }
    nextContent.push(candidate);
  }

  let offset = 0;
  let insertionTemplate: JsonObject | undefined;
  for (const [index, value] of textNodes.entries()) {
    const textNode = value as JsonObject;
    const text = [...String(textNode.text)];
    const end = offset + text.length;
    if (change.from < end || (change.from === totalLength && index === textNodes.length - 1)) {
      insertionTemplate ??= textNode;
    }
    if (offset < change.from) {
      append(textNode, text.slice(0, Math.min(text.length, change.from - offset)).join(""));
    }
    offset = end;
  }

  if (insertionTemplate === undefined) {
    return undefined;
  }
  append(insertionTemplate, change.text);

  offset = 0;
  for (const value of textNodes) {
    const textNode = value as JsonObject;
    const text = [...String(textNode.text)];
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

export function applyDocumentChanges(
  document: MaterialDocumentV1,
  changes: readonly DocumentChange[],
): ContentSchemaResult<MaterialDocumentV1> {
  let current = document;

  for (const [index, change] of changes.entries()) {
    if (change.kind === "replace_document") {
      const replacement = acceptDocument(change.document);
      if (!replacement.ok) {
        return replacement;
      }
      current = replacement.value;
      continue;
    }

    const blocks = contentBlocks(current);
    if (blocks === undefined) {
      return fail(index, "invalid_document_structure");
    }

    if (change.kind === "insert_blocks") {
      const insertionIndex =
        change.afterNodeId === null
          ? 0
          : blocks.findIndex((block) => nodeId(block) === change.afterNodeId) + 1;
      if (insertionIndex === 0 && change.afterNodeId !== null) {
        return fail(index, "node_not_found");
      }
      const inserted = change.blocks.map((block) => withNodeId(block));
      if (inserted.some((block) => block === undefined)) {
        return fail(index, "invalid_block");
      }
      blocks.splice(insertionIndex, 0, ...(inserted as JsonObject[]));
    } else {
      const targetIndex = blocks.findIndex((block) => nodeId(block) === change.nodeId);
      if (targetIndex < 0) {
        return fail(index, "node_not_found");
      }
      if (change.kind === "delete_block") {
        blocks.splice(targetIndex, 1);
      } else if (change.kind === "replace_block") {
        const replacement = withNodeId(change.block, change.nodeId);
        if (replacement === undefined) {
          return fail(index, "invalid_block");
        }
        blocks[targetIndex] = replacement;
      } else {
        const replacement = replaceText(blocks[targetIndex] as JsonValue, change);
        if (replacement === undefined) {
          return fail(index, "invalid_text_range");
        }
        blocks[targetIndex] = replacement;
      }
    }

    const accepted = acceptDocument({
      schemaVersion: 1,
      doc: { ...current.doc, content: blocks },
    });
    if (!accepted.ok) {
      return accepted;
    }
    current = accepted.value;
  }

  return { ok: true, value: current };
}
