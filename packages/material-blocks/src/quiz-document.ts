import { materialHeadingAnchors } from "./heading-anchors.js";
import { materialBlockChildren } from "./extract.js";
import type { RenderedBlock } from "./rendered-block.js";

/** Quiz review links address narrative headings, never hidden answers or question text. */
export function materialQuizReferencesValid(
  blocks: readonly RenderedBlock[],
): boolean {
  const anchors = new Set(materialHeadingAnchors(blocks).values());
  const ids = new Set<string>();
  function valid(block: RenderedBlock): boolean {
    if (block.kind !== "quiz") return materialBlockChildren(block).every(valid);
    if (ids.has(block.id)) return false;
    ids.add(block.id);
    return block.dontKnow.reviewLinks.every((href) => {
      try {
        return anchors.has(decodeURIComponent(href.slice(1)));
      } catch {
        return false;
      }
    });
  }
  return blocks.every(valid);
}
