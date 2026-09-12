import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { nodeAttributes } from "../document-node.js";
import { stringAttribute } from "../json.js";
import type { RenderedBlock } from "../rendered-block.js";
import { nestedBlocks } from "./nested-blocks.js";

const calloutTones = ["note", "tip", "warning"] as const;

const calloutToneSchema = z.enum(calloutTones);

type CalloutTone = z.infer<typeof calloutToneSchema>;

function isCalloutTone(value: unknown): value is CalloutTone {
  return calloutToneSchema.safeParse(value).success;
}

const nested = nestedBlocks<Extract<RenderedBlock, { kind: "callout" }>>();

export const calloutBlock = defineMaterialBlock<"callout">({
  ...nested,
  issues: (node, report) => {
    if (!isCalloutTone(stringAttribute(node, "kind"))) {
      report("invalid_callout_kind", "kind");
    }
  },
  kind: "callout",
  node: {
    attributes: { kind: "note" },
    content: "block+",
    defining: true,
    group: "block",
    // One DOM contract for both applications: the server's, which writes the real kind. The
    // editor's copy hardcoded `note`, which only ever reached the clipboard.
    parseHTML: ["aside[data-callout]"],
    renderHTML: (attributes) => [
      "aside",
      { ...attributes, "data-callout": attributes.kind },
      0,
    ],
  },
  render: (node, tools) => {
    const tone = nodeAttributes(node).kind;
    if (!isCalloutTone(tone)) {
      throw new TypeError("Unsupported callout tone");
    }
    return { content: tools.blockContent(node), kind: "callout", tone };
  },
  renderedSchema: (block) =>
    z
      .object({
        content: z.array(block),
        kind: z.literal("callout"),
        tone: calloutToneSchema,
      })
      .strict(),
  type: "callout",
});
