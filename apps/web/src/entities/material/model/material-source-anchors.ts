import type { RenderedBlock } from "@inside/material-blocks";

/** Content assigns source anchors in reader order, including occupied suffixes. */
export function materialSourceAnchors(
  blocks: readonly RenderedBlock[],
): ReadonlyMap<string, string> {
  const anchors = new Map<string, string>();
  const used = new Set<string>();
  function visit(children: readonly RenderedBlock[], path: readonly number[]) {
    children.forEach((block, index) => {
      const at = [...path, index];
      if (
        block.kind === "blockquote" ||
        block.kind === "callout" ||
        block.kind === "takeaways"
      )
        visit(block.content, at);
      if (block.kind === "bullet_list" || block.kind === "ordered_list")
        block.items.forEach((item, branch) => {
          visit(item, [...at, branch]);
        });
      if (block.kind === "variant")
        block.options.forEach((option, branch) => {
          visit(option.content, [...at, branch]);
        });
      if (block.kind === "table")
        block.rows.forEach((row, r) => {
          row.cells.forEach((cell, c) => {
            visit(cell.content, [...at, r, c]);
          });
        });
      if (block.kind !== "heading") return;
      const text = block.content.map((part) => part.text).join("");
      const slug = text
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_ -]/gu, "")
        .replaceAll(" ", "-");
      let anchor = slug;
      let suffix = 0;
      while (used.has(anchor)) anchor = `${slug}-${String(++suffix)}`;
      used.add(anchor);
      anchors.set(at.join("-"), anchor);
    });
  }
  visit(blocks, []);
  return anchors;
}
