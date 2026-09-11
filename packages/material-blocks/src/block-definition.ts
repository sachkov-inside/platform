import type { z } from "zod";

import type { JsonObject, JsonValue } from "./json.js";
import type {
  MaterialBodyHeading,
  MaterialBodyResourceSummary,
  RenderedBlock,
  RenderedBlockKind,
  RenderedText,
} from "./rendered-block.js";

/**
 * One variant of the rendered-block union. `discriminatedUnion` needs the discriminator to stay
 * visible in the type, so the registry keeps this shape instead of the erased `z.ZodType`.
 */
export type RenderedBlockVariantSchema<Block extends RenderedBlock = RenderedBlock> =
  z.ZodType<Block> & z.core.$ZodTypeDiscriminable<"kind">;

/**
 * ProseMirror node declaration as plain data. The registry stays free of Tiptap; the document
 * schema entry point turns these descriptions into Tiptap nodes.
 */
export interface MaterialBlockNodeDescription {
  readonly atom?: boolean;
  /** Attribute name to its default value. */
  readonly attributes: Readonly<Record<string, JsonValue>>;
  readonly content?: string;
  readonly defining?: boolean;
  readonly draggable?: boolean;
  readonly group: "block";
  readonly parseHTML: readonly string[];
  readonly renderHTML: (
    attributes: Readonly<Record<string, unknown>>,
  ) => [string, ...unknown[]];
}

/** Reports one field rule failure. `attribute` names the offending `attrs` entry. */
export type MaterialBlockIssueReport = (code: string, attribute: string) => void;

/** Recursion the renderer owns, handed to a block so definitions stay independent. */
export interface MaterialBlockRenderTools {
  readonly blockContent: (node: JsonObject) => readonly RenderedBlock[];
  readonly inlineContent: (node: JsonObject) => readonly RenderedText[];
}

/** Recursion the search-text extraction owns. */
export interface MaterialBlockTextTools {
  readonly blockText: (block: RenderedBlock) => string;
  readonly inlineText: (content: readonly RenderedText[]) => string;
}

type BlockOf<Kind extends RenderedBlockKind> = Extract<RenderedBlock, { kind: Kind }>;

/**
 * Registers one block under the registry's element type. Every dispatch selects a definition by
 * the block's own `kind`, so the narrowed parameters can only ever receive their own variant;
 * TypeScript checks method parameters strictly and cannot see that guarantee.
 */
export function defineMaterialBlock<Kind extends RenderedBlockKind>(
  definition: MaterialBlockDefinition<Kind>,
): MaterialBlockDefinition {
  // TypeScript marks `Kind` invariant because it appears in both method parameters and
  // results, so the erasure needs an explicit conversion.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return definition as unknown as MaterialBlockDefinition;
}

/**
 * Everything the platform knows about one material block. Method syntax keeps a narrowed
 * definition assignable to the registry's `RenderedBlockKind` element type; the `kind`
 * discriminator is what makes each dispatch pick the matching definition.
 */
export interface MaterialBlockDefinition<
  Kind extends RenderedBlockKind = RenderedBlockKind,
> {
  readonly kind: Kind;
  /** Present only for blocks this registry declares itself; the rest come from Tiptap kits. */
  readonly node?: MaterialBlockNodeDescription;
  /** ProseMirror node type name. */
  readonly type: string;

  /** Nested blocks in document order; used by extraction and by asset hydration. */
  children?(block: BlockOf<Kind>): readonly RenderedBlock[];
  /** Contribution to the table of contents. */
  heading?(block: BlockOf<Kind>, tools: MaterialBlockTextTools): MaterialBodyHeading;
  /** Field rules beyond the shape the ProseMirror schema already enforces. */
  issues?(node: JsonObject, report: MaterialBlockIssueReport): void;
  /** Rebuilds the block with every nested block replaced. */
  mapChildren?(
    block: BlockOf<Kind>,
    map: (child: RenderedBlock) => RenderedBlock,
  ): BlockOf<Kind>;
  /** Accepted document node to the rendered block a reader or the wire contract sees. */
  render(node: JsonObject, tools: MaterialBlockRenderTools): BlockOf<Kind>;
  /**
   * Rendered shape for the wire contract and the reading client. `block` is the schema for
   * nested blocks, so one recursive union covers the whole document.
   */
  renderedSchema(block: z.ZodType<RenderedBlock>): RenderedBlockVariantSchema<BlockOf<Kind>>;
  /** Asset the block references, for the extraction summary. */
  resource?(block: BlockOf<Kind>): MaterialBodyResourceSummary;
  /** Plain text for full-text search. */
  text(block: BlockOf<Kind>, tools: MaterialBlockTextTools): string;
}
