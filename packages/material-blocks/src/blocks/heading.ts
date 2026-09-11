import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { nodeAttributes } from "../document-node.js";
import {
  headingLevelSchema,
  isHeadingLevel,
  renderedTextSchema,
} from "../rendered-block.js";

export const headingBlock = defineMaterialBlock<"heading">({
  heading: (block, tools) => ({ level: block.level, text: tools.inlineText(block.content) }),
  kind: "heading",
  render: (node, tools) => {
    const level = nodeAttributes(node).level;
    if (!isHeadingLevel(level)) {
      throw new TypeError("Unsupported heading level");
    }
    return { content: tools.inlineContent(node), kind: "heading", level };
  },
  renderedSchema: () =>
    z
      .object({
        content: z.array(renderedTextSchema),
        kind: z.literal("heading"),
        level: headingLevelSchema,
      })
      .strict(),
  text: (block, tools) => tools.inlineText(block.content),
  type: "heading",
});
