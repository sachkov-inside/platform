import { addressableMaterialBlockTypes } from "@inside/material-blocks";
import type { JSONContent } from "@tiptap/core";

const addressable: ReadonlySet<string> = new Set(addressableMaterialBlockTypes);
/** Freeze generated IDs in the submitted snapshot so a lost response can be retried verbatim. */
export function withMaterialNodeIds(node: JSONContent): JSONContent {
  const nodeId: unknown = node.attrs?.nodeId;
  return {
    ...node,
    ...(addressable.has(node.type ?? "")
      ? {
          attrs: {
            ...node.attrs,
            nodeId: typeof nodeId === "string" ? nodeId : crypto.randomUUID(),
          },
        }
      : {}),
    ...(node.content ? { content: node.content.map(withMaterialNodeIds) } : {}),
  };
}
