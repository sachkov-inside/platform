import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { renderedTextSchema } from "../rendered-block.js";

/** One short thought the reader should leave with; the lesson marks it instead of bolding it. */
export const keyPointBlock = defineMaterialBlock<"key_point">({
  kind: "key_point",
  node: {
    attributes: {},
    content: "inline*",
    defining: true,
    group: "block",
    parseHTML: ['p[data-material-block="keyPoint"]'],
    renderHTML: (attributes) => [
      "p",
      { ...attributes, "data-material-block": "keyPoint" },
      0,
    ],
  },
  render: (node, tools) => ({ content: tools.inlineContent(node), kind: "key_point" }),
  renderedSchema: () =>
    z
      .object({ content: z.array(renderedTextSchema), kind: z.literal("key_point") })
      .strict(),
  text: (block, tools) => tools.inlineText(block.content),
  type: "keyPoint",
});
