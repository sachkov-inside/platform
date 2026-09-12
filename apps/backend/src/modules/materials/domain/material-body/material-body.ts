import type {
  JsonObject,
  MaterialBodyHeading,
  MaterialBodyResourceSummary,
  RenderedMaterialBody,
} from "@inside/material-blocks";

import type { Result } from "../../result.js";

export type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  MaterialBodyHeading,
  MaterialBodyResourceSummary,
  RenderedBlock,
  RenderedMark,
  RenderedMaterialBody,
  RenderedText,
} from "@inside/material-blocks";

export interface MaterialBodySnapshot {
  readonly schemaVersion: 1;
  readonly doc: JsonObject;
}

declare const validatedMaterialBody: unique symbol;

export type MaterialBody = MaterialBodySnapshot & {
  readonly [validatedMaterialBody]: true;
};

export interface ValidationIssue {
  readonly code: string;
  readonly path: string;
}

export interface MaterialBodyExtraction {
  readonly plainText: string;
  readonly headings: readonly MaterialBodyHeading[];
  readonly resources: readonly MaterialBodyResourceSummary[];
}

export type MaterialBodyValidationError = {
  readonly code: "invalid_content";
  readonly issues: readonly ValidationIssue[];
};

export type MaterialBodyResult<Value> = Result<Value, MaterialBodyValidationError>;

export type MaterialBodyChange =
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

export interface MaterialBodyOperations {
  accept(
    input: unknown,
    options?: { readonly assignMissingNodeIds?: boolean },
  ): MaterialBodyResult<MaterialBody>;
  applyChanges(
    document: MaterialBodySnapshot,
    changes: readonly MaterialBodyChange[],
  ): MaterialBodyResult<MaterialBody>;
  render(
    document: MaterialBodySnapshot,
  ): MaterialBodyResult<RenderedMaterialBody>;
  extract(
    document: MaterialBodySnapshot,
  ): MaterialBodyResult<MaterialBodyExtraction>;
}
