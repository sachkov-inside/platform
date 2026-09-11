import type { MaterialBlockTextTools } from "./block-definition.js";
import { materialBlockByKind } from "./registry.js";
import type {
  MaterialBodyHeading,
  MaterialBodyResourceSummary,
  RenderedBlock,
} from "./rendered-block.js";
import { inlineText } from "./rendered-block.js";

const tools: MaterialBlockTextTools = {
  blockText: materialBlockText,
  inlineText,
};

/** Plain text of one block, for the full-text search document. */
export function materialBlockText(block: RenderedBlock): string {
  return materialBlockByKind(block.kind).text(block, tools);
}

/** Nested blocks in document order. */
export function materialBlockChildren(
  block: RenderedBlock,
): readonly RenderedBlock[] {
  return materialBlockByKind(block.kind).children?.(block) ?? [];
}

/** Rebuilds the block with every nested block replaced. */
export function mapMaterialBlockChildren(
  block: RenderedBlock,
  map: (child: RenderedBlock) => RenderedBlock,
): RenderedBlock {
  return materialBlockByKind(block.kind).mapChildren?.(block, map) ?? block;
}

/** Table-of-contents entry the block contributes, when it contributes one. */
export function materialBlockHeading(
  block: RenderedBlock,
): MaterialBodyHeading | undefined {
  return materialBlockByKind(block.kind).heading?.(block, tools);
}

/** Asset the block references, when it references one. */
export function materialBlockResource(
  block: RenderedBlock,
): MaterialBodyResourceSummary | undefined {
  return materialBlockByKind(block.kind).resource?.(block);
}
