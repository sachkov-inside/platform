import { randomUUID } from "node:crypto";

import type {
  ContentSchemaResult,
  DocumentChange,
  JsonObject,
  JsonValue,
  MaterialDocumentV1,
} from "../content-schema.interface.js";
import { acceptDocument } from "./accept-document.js";

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
  stableNodeId: string = randomUUID(),
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
  candidate.attrs = { ...(candidate.attrs ?? {}), nodeId: stableNodeId };
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
  if (!isJsonObject(block) || !Array.isArray(block.content) || block.content.length !== 1) {
    return undefined;
  }
  const textNode = block.content[0];
  if (!isJsonObject(textNode) || textNode.type !== "text" || typeof textNode.text !== "string") {
    return undefined;
  }
  const codePoints = [...textNode.text];
  if (
    !Number.isInteger(change.from) ||
    !Number.isInteger(change.to) ||
    change.from < 0 ||
    change.to < change.from ||
    change.to > codePoints.length
  ) {
    return undefined;
  }
  const nextText = [
    ...codePoints.slice(0, change.from),
    ...change.text,
    ...codePoints.slice(change.to),
  ].join("");
  return {
    ...block,
    content: [{ ...textNode, text: nextText }],
  };
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
