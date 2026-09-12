import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { expectArray, expectObject, nodeAttributes } from "../document-node.js";
import type { JsonObject } from "../json.js";
import { isJsonArray, isJsonObject } from "../json.js";

/**
 * How a reader goes through a guide. The names match the authoring base, whose variant callouts
 * are `variant-example` and `variant-own`, so an imported step keeps its own branch names and
 * needs no translation table.
 */
export const guideModes = ["example", "own"] as const;

const guideModeSchema = z.enum(guideModes);

export type GuideMode = z.infer<typeof guideModeSchema>;

/**
 * The name each mode carries for a reader. It lives with the block because the switch, the hint
 * and the editor all print the same words.
 */
export const guideModeLabels: Readonly<Record<GuideMode, string>> = {
  example: "Учебный проект",
  own: "Свой проект",
};

/** A reader who has never chosen follows the worked example. */
export const defaultGuideMode: GuideMode = "example";

export function isGuideMode(value: unknown): value is GuideMode {
  return guideModeSchema.safeParse(value).success;
}

/** The child node one branch of a variant block is written into. */
export const variantOptionType = "variantOption";

function optionNodes(node: JsonObject): readonly JsonObject[] {
  const content = node.content;
  return content === undefined || !isJsonArray(content)
    ? []
    : content.filter(isJsonObject);
}

/**
 * One step written for both ways of going through a guide. The reader sees the branch of the
 * active mode; a block that carries a single branch belongs to that mode alone.
 */
export const variantBlock = defineMaterialBlock<"variant">({
  children: (block) => block.options.flatMap((option) => option.content),
  issues: (node, report) => {
    // The document schema bounds the branches at two and keeps them inside this block; what it
    // cannot say is that each branch names a mode the registry knows, and names a different one.
    // Both are reported against the block, because a branch carries no field of its own to name.
    const modes = optionNodes(node).map((option) => nodeAttributes(option).mode);
    if (!modes.every(isGuideMode)) {
      report("invalid_variant_mode", "mode");
    }
    if (new Set(modes).size !== modes.length) {
      report("duplicate_variant_mode", "mode");
    }
  },
  kind: "variant",
  mapChildren: (block, map) => ({
    ...block,
    options: block.options.map((option) => ({
      ...option,
      content: option.content.map(map),
    })),
  }),
  node: {
    attributes: {},
    childNodes: {
      [variantOptionType]: {
        attributes: { mode: defaultGuideMode },
        content: "block+",
        defining: true,
        // The mode is both the field and the selector the block is parsed back by, so it travels
        // through one DOM attribute instead of being written twice.
        domAttributes: { mode: "data-variant-option" },
        parseHTML: ["section[data-variant-option]"],
        renderHTML: (attributes) => ["section", { ...attributes }, 0],
      },
    },
    content: `${variantOptionType} ${variantOptionType}?`,
    defining: true,
    group: "block",
    parseHTML: ['div[data-material-block="variant"]'],
    renderHTML: (attributes) => [
      "div",
      { ...attributes, "data-material-block": "variant" },
      0,
    ],
  },
  render: (node, tools) => ({
    kind: "variant",
    options: expectArray(node.content, "variant options").map((value) => {
      const option = expectObject(value, "variant option");
      if (option.type !== variantOptionType) {
        throw new TypeError("Expected variant option");
      }
      const mode = nodeAttributes(option).mode;
      if (!isGuideMode(mode)) {
        throw new TypeError("Unsupported guide mode");
      }
      return { content: tools.blockContent(option), mode };
    }),
  }),
  renderedSchema: (block) =>
    z
      .object({
        kind: z.literal("variant"),
        options: z.array(
          z.object({ content: z.array(block), mode: guideModeSchema }).strict(),
        ),
      })
      .strict(),
  // Both branches reach the search document: a reader looking for the words of the branch they
  // do not currently see still has to find the lesson that holds them.
  text: (block, tools) =>
    block.options
      .map((option) => option.content.map(tools.blockText).filter(Boolean).join("\n\n"))
      .filter(Boolean)
      .join("\n\n"),
  type: "variant",
});
