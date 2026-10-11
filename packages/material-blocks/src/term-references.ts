import { materialBlockChildren } from "./extract.js";
import type { RenderedBlock } from "./rendered-block.js";

/** Includes nested callouts, variants and the rendered children held inside quiz atoms. */
export function referencedTermIds(
  blocks: readonly RenderedBlock[],
): readonly string[] {
  const ids = new Set<string>();
  function walk(block: RenderedBlock): void {
    if (
      block.kind === "paragraph" ||
      block.kind === "heading" ||
      block.kind === "key_point"
    ) {
      for (const text of block.content)
        for (const mark of text.marks)
          if (mark.kind === "term") ids.add(mark.termId.toLowerCase());
    }
    materialBlockChildren(block).forEach(walk);
  }
  blocks.forEach(walk);
  return [...ids].sort();
}
