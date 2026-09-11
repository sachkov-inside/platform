import type { MaterialBlockTextTools } from "../block-definition.js";
import type { RenderedBlock } from "../rendered-block.js";

type NestingBlock = Extract<RenderedBlock, { content: readonly RenderedBlock[] }>;

/**
 * Traversal shared by blocks whose whole body is a sequence of nested blocks.
 */
export function nestedBlocks<Block extends NestingBlock>(): {
  children: (block: Block) => readonly RenderedBlock[];
  mapChildren: (block: Block, map: (child: RenderedBlock) => RenderedBlock) => Block;
  text: (block: Block, tools: MaterialBlockTextTools) => string;
} {
  return {
    children: (block) => block.content,
    mapChildren: (block, map) => ({ ...block, content: block.content.map(map) }),
    text: (block, tools) => block.content.map(tools.blockText).filter(Boolean).join("\n\n"),
  };
}
