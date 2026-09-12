import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { expectString, nodeAttributes, optionalText } from "../document-node.js";
import { isJsonObject } from "../json.js";
import { optionalTitleIssue, requiredTextIssue } from "./block-fields.js";

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
    optionalTitleIssue(node, report, "invalid_resource_description", "description");
  },
  kind: "resource_card",
  node: {
    atom: true,
    attributes: { description: null, title: "", url: "" },
    draggable: true,
    group: "block",
    parseHTML: ['[data-material-block="resourceCard"]'],
    renderHTML: ({ description, title, url, ...attributes }) => [
      "div",
      { ...attributes, "data-material-block": "resourceCard" },
      ["p", { "data-resource-title": "" }, typeof title === "string" ? title : ""],
      [
        "p",
        { "data-resource-description": "" },
        typeof description === "string" ? description : "",
      ],
      ["a", { href: typeof url === "string" ? url : "" }, "Открыть"],
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
