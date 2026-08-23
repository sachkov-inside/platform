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

export type ContentSchemaResult<Value> =
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

export interface ContentSchema {
  acceptDocument(
    input: unknown,
    options?: { readonly assignMissingNodeIds?: boolean },
  ): ContentSchemaResult<MaterialDocumentV1>;
  applyChanges(
    document: MaterialDocumentV1,
    changes: readonly DocumentChange[],
  ): ContentSchemaResult<MaterialDocumentV1>;
}

export const CONTENT_SCHEMA = Symbol("CONTENT_SCHEMA");
