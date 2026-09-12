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
 * schema entry point turns these descriptions into Tiptap nodes. A block and the child nodes it
 * builds its own content from are declared the same way; only a block carries a group.
 */
export interface MaterialBlockChildNodeDescription {
  readonly atom?: boolean;
  /** Attribute name to its default value. */
  readonly attributes: Readonly<Record<string, JsonValue>>;
  /** Verbatim text content: newlines survive and input rules stay out. */
  readonly code?: boolean;
  readonly content?: string;
  readonly defining?: boolean;
  /**
   * DOM attribute each named field is written to and read back from. A field whose own name is a
   * real HTML attribute, or whose value is not a string, needs one: the clipboard rebuilds a node
   * from its DOM, so a field that never reaches an attribute is lost on paste.
   */
  readonly domAttributes?: Readonly<Record<string, string>>;
  readonly draggable?: boolean;
  /** Accepted inline marks; an empty string keeps the content plain. */
  readonly marks?: string;
  /** Selector of the element holding the content when `renderHTML` also writes a field. */
  readonly parseContent?: string;
  readonly parseHTML: readonly string[];
  /** Keeps newlines and runs of spaces when the content is parsed back from the DOM. */
  readonly preserveWhitespace?: "full";
  readonly renderHTML: (
    attributes: Readonly<Record<string, unknown>>,
  ) => [string, ...unknown[]];
}

/** One block of the registry, plus the child nodes its own content is made of. */
export interface MaterialBlockNodeDescription extends MaterialBlockChildNodeDescription {
  /**
   * Nodes this block builds its content from, by node type. They carry no group, so nothing but
   * this block can contain them — the shape Tiptap already gives `listItem` and `tableRow`. A
   * child node has no registry entry of its own and is therefore never addressed by progress or
   * bookmarks; the block that contains it is.
   */
  readonly childNodes?: Readonly<Record<string, MaterialBlockChildNodeDescription>>;
  readonly group: "block";
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
