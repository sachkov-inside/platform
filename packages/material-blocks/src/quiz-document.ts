import { materialHeadingAnchors } from "./heading-anchors.js";
import { materialBlockChildren } from "./extract.js";
import type { RenderedBlock } from "./rendered-block.js";

/** Quiz review links address narrative headings, never hidden answers or question text. */
export function materialQuizReferenceIssue(
  blocks: readonly RenderedBlock[],
): string | undefined {
  const anchors = new Set(materialHeadingAnchors(blocks).values());
  const ids = new Set<string>();
  function issue(block: RenderedBlock): string | undefined {
    if (block.kind !== "quiz") return firstIssue(materialBlockChildren(block));
    if (ids.has(block.id)) return `Duplicate quiz ID ${block.id}`;
    ids.add(block.id);
    for (const href of block.dontKnow.reviewLinks) {
      try {
        if (anchors.has(decodeURIComponent(href.slice(1)))) continue;
      } catch {
        // A malformed fragment cannot address a narrative heading.
      }
      return `quiz ${block.id}: missing narrative anchor ${href}`;
    }
    return undefined;
  }
  function firstIssue(children: readonly RenderedBlock[]): string | undefined {
    for (const child of children) {
      const found = issue(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return firstIssue(blocks);
}

export function materialQuizReferencesValid(
  blocks: readonly RenderedBlock[],
): boolean {
  return materialQuizReferenceIssue(blocks) === undefined;
}
