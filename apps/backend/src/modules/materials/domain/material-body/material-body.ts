export type JsonPrimitive = boolean | null | number | string;

export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

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

export interface RenderedMaterialBody {
  readonly schemaVersion: 1;
  readonly blocks: readonly RenderedBlock[];
}

export type MaterialBodyResourceSummary =
  | {
      readonly kind: "image";
      readonly alt: string;
      readonly caption?: string;
    }
  | { readonly kind: "file"; readonly label: string }
  | { readonly kind: "video"; readonly caption?: string };

export interface MaterialBodyExtraction {
  readonly plainText: string;
  readonly headings: readonly {
    readonly level: 2 | 3 | 4;
    readonly text: string;
  }[];
  readonly resources: readonly MaterialBodyResourceSummary[];
}

export type MaterialBodyResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "invalid_content";
        readonly issues: readonly ValidationIssue[];
      };
    };

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
