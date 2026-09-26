import { z } from "zod";

import { defineMaterialBlock, type MaterialBlockDefinition } from "../block-definition.js";

export const horizontalRuleBlock: MaterialBlockDefinition = defineMaterialBlock<"horizontal_rule">({
  kind: "horizontal_rule",
  render: () => ({ kind: "horizontal_rule" }),
  renderedSchema: () => z.object({ kind: z.literal("horizontal_rule") }).strict(),
  text: () => "",
  type: "horizontalRule",
});
