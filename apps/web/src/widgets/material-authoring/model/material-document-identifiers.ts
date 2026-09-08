import type { JSONContent } from "@tiptap/core";

export const materialBlockTypes = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "table",
  "callout",
  "assetImage",
  "assetFile",
] as const;
const addressable: ReadonlySet<string> = new Set(materialBlockTypes);
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
