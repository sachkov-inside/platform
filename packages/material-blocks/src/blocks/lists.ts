import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { expectArray, expectObject, nodeAttributes } from "../document-node.js";
import type { MaterialBlockDefinition } from "../block-definition.js";

type ListKind = "bullet_list" | "ordered_list";
const listStartSchema = z.number().int();

function listBlock(type: string, kind: ListKind): MaterialBlockDefinition {
  return defineMaterialBlock<ListKind>({
    children: (block) => block.items.flat(),
    issues: (node, report) => {
      const start = nodeAttributes(node)["start"];
      if (
        kind === "ordered_list" &&
        start !== undefined &&
        !listStartSchema.safeParse(start).success
      ) {
        report("invalid_ordered_list_start", "start");
      }
    },
    kind,
    mapChildren: (block, map) => ({
      ...block,
      items: block.items.map((item) => item.map(map)),
    }),
    render: (node, tools) => ({
      items: expectArray(node["content"], "list items").map((value) => {
        const item = expectObject(value, "list item");
        if (item["type"] !== "listItem") {
          throw new TypeError("Expected list item");
        }
        return tools.blockContent(item);
      }),
      kind,
      ...(kind === "ordered_list" &&
      nodeAttributes(node)["start"] !== undefined &&
      nodeAttributes(node)["start"] !== 1
        ? { start: listStartSchema.parse(nodeAttributes(node)["start"]) }
        : {}),
    }),
    renderedSchema: (block) =>
      kind === "ordered_list"
        ? z
            .object({
              items: z.array(z.array(block)),
              kind: z.literal("ordered_list"),
              start: listStartSchema.optional(),
            })
            .strict()
        : z
            .object({
              items: z.array(z.array(block)),
              kind: z.literal("bullet_list"),
            })
            .strict(),
    text: (block, tools) =>
      block.items
        .map((item) => item.map(tools.blockText).filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n"),
    type,
  });
}

export const bulletListBlock: MaterialBlockDefinition = listBlock(
  "bulletList",
  "bullet_list",
);
export const orderedListBlock: MaterialBlockDefinition = listBlock(
  "orderedList",
  "ordered_list",
);
