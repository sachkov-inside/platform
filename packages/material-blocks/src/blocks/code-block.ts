import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { inlineText } from "../rendered-block.js";

export const codeBlock = defineMaterialBlock<"code_block">({
  kind: "code_block",
  render: (node, tools) => ({
    kind: "code_block",
    text: inlineText(tools.inlineContent(node)),
  }),
  renderedSchema: () =>
    z.object({ kind: z.literal("code_block"), text: z.string() }).strict(),
  text: (block) => block.text,
  type: "codeBlock",
});
