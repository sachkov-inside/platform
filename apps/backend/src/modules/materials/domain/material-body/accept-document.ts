import { z } from "zod";

import type {
  JsonObject,
  JsonValue,
  MaterialBodyResult,
  MaterialBody,
  ValidationIssue,
} from "./material-body.js";
import { assignMissingNodeIds } from "./assign-missing-node-ids.js";
import { DOCUMENT_LIMITS } from "./document-limits.js";
import { addressableBlockTypes } from "./document-rules.js";
import { restoreStoredMaterialBodyV1 } from "./stored-material-body-v1.js";
import { validationIssuePath } from "./validation-issue-path.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const addressableBlockTypeSet = new Set<string>(addressableBlockTypes);

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object" && isJsonValue(value);
}

const envelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    doc: z.custom<JsonObject>(isJsonObject),
  })
  .strict();

function invalid(issues: readonly ValidationIssue[]): MaterialBodyResult<never> {
  return {
    ok: false,
    error: {
      code: "invalid_content",
      issues: [...issues]
        .sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code))
        .slice(0, DOCUMENT_LIMITS.issues),
    },
  };
}

function stringAttribute(node: JsonObject, name: string): string | undefined {
  const attributes = node.attrs;
  if (!isJsonObject(attributes)) {
    return undefined;
  }
  const value = attributes[name];
  return typeof value === "string" ? value : undefined;
}

function validateUrl(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) {
    return true;
  }
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function validateTree(doc: JsonObject): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set<string>();
  let nodes = 0;
  let textCodePoints = 0;

  function walk(value: JsonValue, path: readonly PropertyKey[], depth: number): void {
    if (issues.length >= DOCUMENT_LIMITS.issues) {
      return;
    }
    if (depth > DOCUMENT_LIMITS.depth) {
      issues.push({ code: "document_too_deep", path: validationIssuePath(path) });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, [...path, index], depth));
      return;
    }
    if (!isJsonObject(value)) {
      return;
    }

    const type = value.type;
    if (typeof type === "string") {
      nodes += 1;
      if (nodes > DOCUMENT_LIMITS.nodes) {
        issues.push({ code: "document_has_too_many_nodes", path: validationIssuePath(path) });
        return;
      }
      if (type === "text" && typeof value.text === "string") {
        textCodePoints += [...value.text].length;
        if (textCodePoints > DOCUMENT_LIMITS.textCodePoints) {
          issues.push({ code: "document_has_too_much_text", path: validationIssuePath([...path, "text"]) });
        }
      }

      if (addressableBlockTypeSet.has(type)) {
        const nodeId = stringAttribute(value, "nodeId");
        if (nodeId === undefined || !uuidPattern.test(nodeId)) {
          issues.push({ code: "invalid_node_id", path: validationIssuePath([...path, "attrs", "nodeId"]) });
        } else if (nodeIds.has(nodeId.toLowerCase())) {
          issues.push({ code: "duplicate_node_id", path: validationIssuePath([...path, "attrs", "nodeId"]) });
        } else {
          nodeIds.add(nodeId.toLowerCase());
        }
      }

      if (type === "callout" && !["note", "tip", "warning"].includes(stringAttribute(value, "kind") ?? "")) {
        issues.push({ code: "invalid_callout_kind", path: validationIssuePath([...path, "attrs", "kind"]) });
      }
      if (type === "assetImage" || type === "assetFile") {
        const assetId = stringAttribute(value, "assetId");
        if (assetId === undefined || !uuidPattern.test(assetId)) {
          issues.push({ code: "invalid_asset_id", path: validationIssuePath([...path, "attrs", "assetId"]) });
        }
        const label = stringAttribute(value, type === "assetImage" ? "alt" : "label");
        if (label === undefined || label.trim().length === 0) {
          issues.push({
            code: type === "assetImage" ? "missing_image_alt" : "missing_file_label",
            path: validationIssuePath([
              ...path,
              "attrs",
              type === "assetImage" ? "alt" : "label",
            ]),
          });
        }
      }
      if (type === "video") {
        const videoId = stringAttribute(value, "videoId");
        if (videoId === undefined || !uuidPattern.test(videoId)) {
          issues.push({ code: "invalid_video_id", path: validationIssuePath([...path, "attrs", "videoId"]) });
        }
      }
    }

    const marks = value.marks;
    if (Array.isArray(marks)) {
      marks.forEach((mark, index) => {
        if (isJsonObject(mark) && mark.type === "link") {
          const href = stringAttribute(mark, "href");
          if (href === undefined || !validateUrl(href)) {
            issues.push({ code: "unsafe_link", path: validationIssuePath([...path, "marks", index, "attrs", "href"]) });
          }
        }
      });
    }

    const content = value.content;
    if (Array.isArray(content)) {
      content.forEach((child, index) => walk(child, [...path, "content", index], depth + 1));
    }
  }

  walk(doc, ["doc"], 1);
  return issues;
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!isJsonObject(value)) {
    return value;
  }
  const canonicalizeChild = (key: string, child: JsonValue): JsonValue => {
    if (key !== "attrs" || !isJsonObject(child)) {
      return canonicalize(child);
    }
    return Object.fromEntries(
      Object.entries(child)
        .filter(([, attribute]) => attribute !== null)
        .filter(
          ([name, attribute]) =>
            !((name === "colspan" || name === "rowspan") && attribute === 1),
        )
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, attribute]) => [
          name,
          (name === "nodeId" || name === "assetId" || name === "videoId") &&
          typeof attribute === "string" &&
          uuidPattern.test(attribute)
            ? attribute.toLowerCase()
            : canonicalize(attribute),
        ]),
    );
  };
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalizeChild(key, child)] as const)
    .filter(
      ([key, child]) =>
        !(key === "attrs" && isJsonObject(child) && Object.keys(child).length === 0),
    );
  return Object.fromEntries(entries);
}

export function acceptDocument(
  input: unknown,
  roundTrip: (document: JsonObject) => JsonObject,
  options?: { readonly assignMissingNodeIds?: boolean },
): MaterialBodyResult<MaterialBody> {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return invalid([{ code: "document_is_not_json", path: "" }]);
  }
  if (serialized === undefined) {
    return invalid([{ code: "document_is_not_json", path: "" }]);
  }

  let candidate = input;
  if (options?.assignMissingNodeIds === true) {
    try {
      candidate = structuredClone(input);
    } catch {
      return invalid([{ code: "document_is_not_json", path: "" }]);
    }
  }
  if (options?.assignMissingNodeIds === true) {
    const document =
      candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)
        ? (candidate as Record<string, unknown>).doc
        : undefined;
    assignMissingNodeIds(document);
  }

  const envelope = envelopeSchema.safeParse(candidate);
  if (!envelope.success) {
    return invalid(
      envelope.error.issues.map((issue) => ({
        code: "invalid_document_envelope",
        path: validationIssuePath(issue.path),
      })),
    );
  }

  const treeIssues = validateTree(envelope.data.doc);
  if (treeIssues.length > 0) {
    return invalid(treeIssues);
  }

  try {
    const roundTripped = roundTrip(envelope.data.doc);
    const canonicalRoundTrip = canonicalize(roundTripped);
    const canonicalInput = canonicalize(envelope.data.doc);
    if (JSON.stringify(canonicalRoundTrip) !== JSON.stringify(canonicalInput)) {
      return invalid([{ code: "document_would_be_normalized", path: "/doc" }]);
    }
    const canonicalSerialized = JSON.stringify(canonicalRoundTrip);
    if (Buffer.byteLength(canonicalSerialized, "utf8") > DOCUMENT_LIMITS.bytes) {
      return invalid([{ code: "document_too_large", path: "" }]);
    }
    if (!isJsonObject(canonicalRoundTrip)) {
      return invalid([{ code: "invalid_prosemirror_document", path: "/doc" }]);
    }
    return {
      ok: true,
      value: restoreStoredMaterialBodyV1({
        schemaVersion: 1,
        doc: canonicalRoundTrip,
      }),
    };
  } catch {
    return invalid([{ code: "invalid_prosemirror_document", path: "/doc" }]);
  }
}
