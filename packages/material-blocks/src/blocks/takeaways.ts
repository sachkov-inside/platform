import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { expectString, nodeAttributes } from "../document-node.js";
import type { RenderedBlock } from "../rendered-block.js";
import { attributeText, requiredTextIssue } from "./block-fields.js";
import { nestedBlocks } from "./nested-blocks.js";

const nested = nestedBlocks<Extract<RenderedBlock, { kind: "takeaways" }>>();

/** What the lesson leaves behind: a named list the reader checks off point by point. */
export const takeawaysBlock = defineMaterialBlock<"takeaways">({
  ...nested,
  issues: (node, report) => {
    requiredTextIssue(node, report, "missing_takeaways_title", "title");
  },
  kind: "takeaways",
  node: {
    // Every point is one paragraph, so Enter starts the next point and nothing else can nest here.
    attributes: { title: "" },
    content: "paragraph+",
    defining: true,
    domAttributes: { title: "data-takeaways-title" },
    group: "block",
    parseContent: "[data-takeaways-body]",
    parseHTML: ['section[data-material-block="takeaways"]'],
    renderHTML: (attributes) => [
      "section",
      { ...attributes, "data-material-block": "takeaways" },
      ["p", { "data-takeaways-name": "" }, attributeText(attributes["data-takeaways-title"])],
      ["div", { "data-takeaways-body": "" }, 0],
    ],
  },
  render: (node, tools) => ({
    content: tools.blockContent(node),
    kind: "takeaways",
    title: expectString(nodeAttributes(node).title, "takeaways title"),
  }),
  renderedSchema: (block) =>
    z
      .object({
        content: z.array(block),
        kind: z.literal("takeaways"),
        title: z.string(),
      })
      .strict(),
  text: (block, tools) =>
    [block.title, nested.text(block, tools)].filter(Boolean).join("\n\n"),
  type: "takeaways",
});
