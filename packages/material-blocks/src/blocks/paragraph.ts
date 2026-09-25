import { z } from "zod";

import { defineMaterialBlock, type MaterialBlockDefinition } from "../block-definition.js";
import { renderedTextSchema } from "../rendered-block.js";

export const paragraphBlock: MaterialBlockDefinition = defineMaterialBlock<"paragraph">({
  kind: "paragraph",
  render: (node, tools) => ({ content: tools.inlineContent(node), kind: "paragraph" }),
  renderedSchema: () =>
    z
      .object({ content: z.array(renderedTextSchema), kind: z.literal("paragraph") })
      .strict(),
  text: (block, tools) => tools.inlineText(block.content),
  type: "paragraph",
});
