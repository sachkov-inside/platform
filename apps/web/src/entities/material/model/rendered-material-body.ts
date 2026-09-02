import { z } from "zod";

export type RenderedMark =
  | { readonly kind: "bold" | "code" | "italic" | "strike" }
  | { readonly href: string; readonly kind: "link" };

export interface RenderedText {
  readonly kind: "text";
  readonly marks: readonly RenderedMark[];
  readonly text: string;
}

export type RenderedBlock =
  | { readonly content: readonly RenderedText[]; readonly kind: "paragraph" }
  | { readonly content: readonly RenderedText[]; readonly kind: "heading"; readonly level: 2 | 3 | 4 }
  | { readonly items: readonly (readonly RenderedBlock[])[]; readonly kind: "bullet_list" | "ordered_list" }
  | { readonly content: readonly RenderedBlock[]; readonly kind: "blockquote" }
  | { readonly kind: "code_block"; readonly text: string }
  | { readonly kind: "horizontal_rule" }
  | { readonly kind: "table"; readonly rows: readonly { readonly cells: readonly { readonly content: readonly RenderedBlock[]; readonly header: boolean }[] }[] }
  | { readonly content: readonly RenderedBlock[]; readonly kind: "callout"; readonly tone: "note" | "tip" | "warning" }
  | {
      readonly alt: string;
      readonly assetId: string;
      readonly caption?: string | undefined;
      readonly height?: number | undefined;
      readonly kind: "image";
      readonly variants?: readonly {
        readonly height: number;
        readonly width: number;
      }[] | undefined;
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

export interface RenderedMaterialBody {
  readonly blocks: readonly RenderedBlock[];
  readonly schemaVersion: 1;
}

export const renderedMarkSchema: z.ZodType<RenderedMark> = z.union([
  z.object({ kind: z.enum(["bold", "code", "italic", "strike"]) }).strict(),
  z.object({ href: z.string(), kind: z.literal("link") }).strict(),
]);

export const renderedTextSchema: z.ZodType<RenderedText> = z
  .object({ kind: z.literal("text"), marks: z.array(renderedMarkSchema), text: z.string() })
  .strict();

export const renderedBlockSchema: z.ZodType<RenderedBlock> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ content: z.array(renderedTextSchema), kind: z.literal("paragraph") }).strict(),
    z.object({ content: z.array(renderedTextSchema), kind: z.literal("heading"), level: z.union([z.literal(2), z.literal(3), z.literal(4)]) }).strict(),
    z.object({ items: z.array(z.array(renderedBlockSchema)), kind: z.literal("bullet_list") }).strict(),
    z.object({ items: z.array(z.array(renderedBlockSchema)), kind: z.literal("ordered_list") }).strict(),
    z.object({ content: z.array(renderedBlockSchema), kind: z.literal("blockquote") }).strict(),
    z.object({ kind: z.literal("code_block"), text: z.string() }).strict(),
    z.object({ kind: z.literal("horizontal_rule") }).strict(),
    z.object({ kind: z.literal("table"), rows: z.array(z.object({ cells: z.array(z.object({ content: z.array(renderedBlockSchema), header: z.boolean() }).strict()) }).strict()) }).strict(),
    z.object({ content: z.array(renderedBlockSchema), kind: z.literal("callout"), tone: z.enum(["note", "tip", "warning"]) }).strict(),
    z.object({
      alt: z.string(),
      assetId: z.uuid(),
      caption: z.string().optional(),
      height: z.number().int().positive().optional(),
      kind: z.literal("image"),
      variants: z
        .array(
          z
            .object({
              height: z.number().int().positive(),
              width: z.number().int().positive(),
            })
            .strict(),
        )
        .optional(),
      width: z.number().int().positive().optional(),
    }).strict(),
    z.object({
      assetId: z.uuid(),
      contentType: z.string().optional(),
      filename: z.string().optional(),
      kind: z.literal("file"),
      label: z.string(),
      size: z.number().int().nonnegative().optional(),
    }).strict(),
  ]),
);

export const renderedMaterialBodySchema: z.ZodType<RenderedMaterialBody> = z
  .object({ blocks: z.array(renderedBlockSchema), schemaVersion: z.literal(1) })
  .strict();
