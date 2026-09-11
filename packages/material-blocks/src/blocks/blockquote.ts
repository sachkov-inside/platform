import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import type { RenderedBlock } from "../rendered-block.js";
import { nestedBlocks } from "./nested-blocks.js";

const nested = nestedBlocks<Extract<RenderedBlock, { kind: "blockquote" }>>();

export const blockquoteBlock = defineMaterialBlock<"blockquote">({
  ...nested,
  kind: "blockquote",
  render: (node, tools) => ({ content: tools.blockContent(node), kind: "blockquote" }),
  renderedSchema: (block) =>
    z.object({ content: z.array(block), kind: z.literal("blockquote") }).strict(),
  type: "blockquote",
});
