import { acceptDocument } from "./accept-document.js";
import { applyDocumentChanges } from "./apply-document-changes.js";
import {
  extractMaterialDocument,
  renderMaterialDocument,
} from "./render-document.js";

export type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface MaterialDocumentV1 {
  readonly schemaVersion: 1;
  readonly doc: JsonObject;
}

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
}

export type RenderedMark =
  | { readonly kind: "bold" | "code" | "italic" | "strike" }
  | { readonly kind: "link"; readonly href: string };

export interface RenderedText {
  readonly kind: "text";
  readonly text: string;
  readonly marks: readonly RenderedMark[];
}

export type RenderedBlock =
  | {
      readonly kind: "paragraph";
      readonly content: readonly RenderedText[];
    }
  | {
      readonly kind: "heading";
      readonly level: 2 | 3 | 4;
      readonly content: readonly RenderedText[];
    }
  | {
      readonly kind: "bullet_list" | "ordered_list";
      readonly items: readonly (readonly RenderedBlock[])[];
    }
  | { readonly kind: "blockquote"; readonly content: readonly RenderedBlock[] }
  | { readonly kind: "code_block"; readonly text: string }
  | { readonly kind: "horizontal_rule" }
  | {
      readonly kind: "table";
      readonly rows: readonly {
        readonly cells: readonly {
          readonly header: boolean;
          readonly content: readonly RenderedBlock[];
        }[];
      }[];
    }
  | {
      readonly kind: "callout";
      readonly tone: "note" | "tip" | "warning";
      readonly content: readonly RenderedBlock[];
    }
  | {
      readonly kind: "image";
      readonly assetId: string;
      readonly alt: string;
      readonly caption?: string;
    }
  | { readonly kind: "file"; readonly assetId: string; readonly label: string }
  | { readonly kind: "video"; readonly videoId: string; readonly caption?: string };

export interface RenderedMaterialDocumentV1 {
  readonly schemaVersion: 1;
  readonly blocks: readonly RenderedBlock[];
}

export type MaterialDocumentResource =
  | {
      readonly kind: "image";
      readonly alt: string;
      readonly caption?: string;
    }
  | { readonly kind: "file"; readonly label: string }
  | { readonly kind: "video"; readonly caption?: string };

export interface MaterialDocumentExtraction {
  readonly plainText: string;
  readonly headings: readonly {
    readonly level: 2 | 3 | 4;
    readonly text: string;
  }[];
  readonly resources: readonly MaterialDocumentResource[];
}

export type MaterialDocumentResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_content";
        readonly issues: readonly ValidationIssue[];
      };
    };

export type DocumentChange =
  | { readonly kind: "replace_document"; readonly document: unknown }
  | {
      readonly kind: "insert_blocks";
      readonly afterNodeId: string | null;
      readonly blocks: readonly unknown[];
    }
  | {
      readonly kind: "replace_block";
      readonly nodeId: string;
      readonly block: unknown;
    }
  | { readonly kind: "delete_block"; readonly nodeId: string }
  | {
      readonly kind: "replace_text";
      readonly nodeId: string;
      readonly from: number;
      readonly to: number;
      readonly text: string;
    };

export interface MaterialDocumentOperations {
  accept(
    input: unknown,
    options?: { readonly assignMissingNodeIds?: boolean },
  ): MaterialDocumentResult<MaterialDocumentV1>;
  applyChanges(
    document: MaterialDocumentV1,
    changes: readonly DocumentChange[],
  ): MaterialDocumentResult<MaterialDocumentV1>;
  render(
    document: MaterialDocumentV1,
  ): MaterialDocumentResult<RenderedMaterialDocumentV1>;
  extract(
    document: MaterialDocumentV1,
  ): MaterialDocumentResult<MaterialDocumentExtraction>;
}

export type MaterialDocumentRoundTrip = (document: JsonObject) => JsonObject;

export function createMaterialDocumentOperations(
  roundTrip: MaterialDocumentRoundTrip,
): MaterialDocumentOperations {
  const accept: MaterialDocumentOperations["accept"] = (input, options) =>
    acceptDocument(input, roundTrip, options);

  return {
    accept,
    applyChanges: (document, changes) =>
      applyDocumentChanges(document, changes, accept),
    render: (document) => {
      const accepted = accept(document);
      return accepted.ok
        ? { ok: true, value: renderMaterialDocument(accepted.value) }
        : accepted;
    },
    extract: (document) => {
      const rendered = accept(document);
      return rendered.ok
        ? {
            ok: true,
            value: extractMaterialDocument(renderMaterialDocument(rendered.value)),
          }
        : rendered;
    },
  };
}
