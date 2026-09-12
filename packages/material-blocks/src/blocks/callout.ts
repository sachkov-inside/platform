import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { nodeAttributes, optionalText } from "../document-node.js";
import { stringAttribute } from "../json.js";
import type { RenderedBlock } from "../rendered-block.js";
import { optionalTitleIssue, titleAttributeSchema } from "./block-fields.js";
import { nestedBlocks } from "./nested-blocks.js";

/**
 * Accepted callout kinds. `note`, `tip` and `warning` are the original set and the lesson kinds
 * were added beside them, so a stored callout stays valid without a migration.
 */
export const calloutTones = [
  "note",
  "tip",
  "warning",
  "example",
  "good",
  "bad",
  "definition",
] as const;

const calloutToneSchema = z.enum(calloutTones);

export type CalloutTone = z.infer<typeof calloutToneSchema>;

/**
 * The name each kind carries for a reader. It lives with the block because the editor writes it
 * into its own DOM and the reading client prints the same word.
 */
export const calloutToneLabels: Readonly<Record<CalloutTone, string>> = {
  bad: "Плохо",
  definition: "Определение",
  example: "Пример",
  good: "Хорошо",
  note: "Примечание",
  tip: "Совет",
  warning: "Важно",
};

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
    optionalTitleIssue(node, report, "invalid_callout_title");
  },
  kind: "callout",
  node: {
    attributes: { kind: "note", title: null },
    content: "block+",
    defining: true,
    group: "block",
    parseContent: "[data-callout-body]",
    // One DOM contract for both applications: the server's, which writes the real kind. The
    // editor's copy hardcoded `note`, which only ever reached the clipboard.
    parseHTML: ["aside[data-callout]"],
    // The name stays out of the element attributes: an HTML `title` would turn the whole callout
    // into a tooltip. Both surfaces read it from its own element instead.
    renderHTML: ({ title, ...attributes }) => [
      "aside",
      { ...attributes, "data-callout": attributes.kind },
      [
        "p",
        { "data-callout-kind": "" },
        calloutToneLabels[isCalloutTone(attributes.kind) ? attributes.kind : "note"],
      ],
      ["p", { "data-callout-title": "" }, typeof title === "string" ? title : ""],
      ["div", { "data-callout-body": "" }, 0],
    ],
  },
  render: (node, tools) => {
    const attributes = nodeAttributes(node);
    const tone = attributes.kind;
    if (!isCalloutTone(tone)) {
      throw new TypeError("Unsupported callout tone");
    }
    const title = optionalText(attributes.title);
    return {
      content: tools.blockContent(node),
      kind: "callout",
      ...(title === undefined ? {} : { title }),
      tone,
    };
  },
  renderedSchema: (block) =>
    z
      .object({
        content: z.array(block),
        kind: z.literal("callout"),
        title: titleAttributeSchema,
        tone: calloutToneSchema,
      })
      .strict(),
  text: (block, tools) =>
    [block.title, nested.text(block, tools)].filter(Boolean).join("\n\n"),
  type: "callout",
});
