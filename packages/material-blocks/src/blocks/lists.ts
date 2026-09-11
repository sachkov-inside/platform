import { z } from "zod";

import { defineMaterialBlock } from "../block-definition.js";
import { expectArray, expectObject } from "../document-node.js";
import type { MaterialBlockDefinition } from "../block-definition.js";

type ListKind = "bullet_list" | "ordered_list";

function listBlock(
  type: string,
  kind: ListKind,
): MaterialBlockDefinition {
  return defineMaterialBlock<ListKind>({
    children: (block) => block.items.flat(),
    kind,
    mapChildren: (block, map) => ({
      ...block,
      items: block.items.map((item) => item.map(map)),
    }),
    render: (node, tools) => ({
      items: expectArray(node.content, "list items").map((value) => {
        const item = expectObject(value, "list item");
        if (item.type !== "listItem") {
          throw new TypeError("Expected list item");
        }
        return tools.blockContent(item);
      }),
      kind,
    }),
    renderedSchema: (block) =>
      z.object({ items: z.array(z.array(block)), kind: z.literal(kind) }).strict(),
    text: (block, tools) =>
      block.items
        .map((item) => item.map(tools.blockText).filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n"),
    type,
  });
}

export const bulletListBlock = listBlock("bulletList", "bullet_list");
export const orderedListBlock = listBlock("orderedList", "ordered_list");
