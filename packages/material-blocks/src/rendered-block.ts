import { z } from "zod";

export type RenderedMark =
  | { readonly kind: "bold" | "code" | "italic" | "strike" }
  | { readonly href: string; readonly kind: "link" };

export interface RenderedText {
  readonly kind: "text";
  readonly marks: readonly RenderedMark[];
  readonly text: string;
}

export type HeadingLevel = 2 | 3 | 4;

/** One term of a labeled list: a short label, the term it marks and an optional explanation. */
export interface MaterialLabeledRow {
  readonly description?: string | undefined;
  readonly label: string;
  readonly name: string;
}

/**
 * A rendered block is recursive, so TypeScript cannot infer this union from the registry's
 * schemas: the schemas need the type to describe their own nested content. The two stay in step
 * because `defineMaterialBlock` accepts only a `kind` this union declares, and the wire
 * enumeration is built from the registry rather than from a second list.
 */
export type RenderedBlock =
  | { readonly content: readonly RenderedText[]; readonly kind: "paragraph" }
  | {
      readonly content: readonly RenderedText[];
      readonly kind: "heading";
      readonly level: HeadingLevel;
    }
  | {
      readonly items: readonly (readonly RenderedBlock[])[];
      readonly kind: "bullet_list" | "ordered_list";
    }
  | { readonly content: readonly RenderedBlock[]; readonly kind: "blockquote" }
  | { readonly kind: "code_block"; readonly text: string }
  | { readonly kind: "horizontal_rule" }
  | {
      readonly kind: "table";
      readonly rows: readonly {
        readonly cells: readonly {
          readonly content: readonly RenderedBlock[];
          readonly header: boolean;
        }[];
      }[];
    }
  | {
      readonly content: readonly RenderedBlock[];
      readonly kind: "callout";
      readonly title?: string | undefined;
      readonly tone:
        | "bad"
        | "definition"
        | "example"
        | "good"
        | "note"
        | "tip"
        | "warning";
    }
  | {
      readonly description?: string | undefined;
      readonly kind: "resource_card";
      readonly title: string;
      readonly url: string;
    }
  | {
      readonly kind: "agent_prompt";
      readonly text: string;
      readonly title?: string | undefined;
    }
  | {
      readonly content: readonly RenderedBlock[];
      readonly kind: "takeaways";
      readonly title: string;
    }
  | {
      readonly kind: "labeled_list";
      readonly rows: readonly MaterialLabeledRow[];
    }
  | { readonly content: readonly RenderedText[]; readonly kind: "key_point" }
  | {
      readonly alt: string;
      readonly assetId: string;
      readonly caption?: string | undefined;
      readonly displayWidthPercent?: number | undefined;
      readonly height?: number | undefined;
      readonly kind: "image";
      readonly variants?:
        | readonly { readonly height: number; readonly width: number }[]
        | undefined;
      readonly width?: number | undefined;
    }
  | {
      readonly assetId: string;
      readonly contentType?: string | undefined;
      readonly filename?: string | undefined;
      readonly kind: "file";
      readonly label: string;
      readonly size?: number | undefined;
    };

export type RenderedBlockKind = RenderedBlock["kind"];

export interface RenderedMaterialBody {
  readonly blocks: readonly RenderedBlock[];
  readonly schemaVersion: 1;
}

export interface MaterialBodyHeading {
  readonly level: HeadingLevel;
  readonly text: string;
}

export type MaterialBodyResourceSummary =
  | {
      readonly alt: string;
      readonly assetId: string;
      readonly caption?: string | undefined;
      readonly kind: "image";
    }
  | { readonly assetId: string; readonly kind: "file"; readonly label: string };

export const renderedMarkSchema: z.ZodType<RenderedMark> = z.union([
  z.object({ kind: z.enum(["bold", "code", "italic", "strike"]) }).strict(),
  z.object({ href: z.string(), kind: z.literal("link") }).strict(),
]);

export const renderedTextSchema: z.ZodType<RenderedText> = z
  .object({
    kind: z.literal("text"),
    marks: z.array(renderedMarkSchema),
    text: z.string(),
  })
  .strict();

const headingLevelSchemas = [z.literal(2), z.literal(3), z.literal(4)] as const;

export const headingLevelSchema = z.union(headingLevelSchemas);

/** Text a run of inline content carries, without its marks. */
export function inlineText(content: readonly RenderedText[]): string {
  return content.map(({ text }) => text).join("");
}

/** Material headings start at the second level: the material title owns the first. */
export const headingLevels = headingLevelSchemas.map((schema) => schema.value);

export function isHeadingLevel(value: unknown): value is HeadingLevel {
  return headingLevelSchema.safeParse(value).success;
}
