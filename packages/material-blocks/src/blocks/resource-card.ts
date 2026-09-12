import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { expectString, nodeAttributes, optionalText } from "../document-node.js";
import { isJsonObject } from "../json.js";
import { attributeText, optionalTextIssue, requiredTextIssue } from "./block-fields.js";

/** The address a reader may open from a lesson: an absolute https link and nothing else. */
const resourceUrlSchema = z.url({ protocol: /^https$/u });

function urlIssue(value: unknown): boolean {
  if (typeof value !== "string") return true;
  // An address the author has not typed yet is not an error; publishing an unusable one is.
  return value.length > 0 && !resourceUrlSchema.safeParse(value).success;
}

/** A named external resource the reader opens from the lesson. */
export const resourceCardBlock = defineMaterialBlock<"resource_card">({
  issues: (node, report) => {
    requiredTextIssue(node, report, "missing_resource_title", "title");
    const attributes = isJsonObject(node.attrs) ? node.attrs : undefined;
    if (urlIssue(attributes?.url)) {
      report("invalid_resource_url", "url");
    }
    optionalTextIssue(node, report, "invalid_resource_description", "description");
  },
  kind: "resource_card",
  node: {
    atom: true,
    attributes: { description: null, title: "", url: "" },
    // `title` is a real HTML attribute; the other two travel under their own names, as the asset
    // blocks already do, so a copied card comes back whole.
    domAttributes: { title: "data-resource-title" },
    draggable: true,
    group: "block",
    parseHTML: ['[data-material-block="resourceCard"]'],
    renderHTML: (attributes) => [
      "div",
      { ...attributes, "data-material-block": "resourceCard" },
      ["p", {}, attributeText(attributes["data-resource-title"])],
      ["p", {}, attributeText(attributes.description)],
      ["a", { href: attributeText(attributes.url) }, "Открыть"],
    ],
  },
  render: (node) => {
    const attributes = nodeAttributes(node);
    const description = optionalText(attributes.description);
    return {
      ...(description === undefined ? {} : { description }),
      kind: "resource_card",
      title: expectString(attributes.title, "resource title"),
      url: expectString(attributes.url, "resource url"),
    };
  },
  renderedSchema: () =>
    z
      .object({
        description: z.string().optional(),
        kind: z.literal("resource_card"),
        title: z.string(),
        url: z.string(),
      })
      .strict(),
  text: (block) => [block.title, block.description, block.url].filter(Boolean).join("\n"),
  type: "resourceCard",
});
