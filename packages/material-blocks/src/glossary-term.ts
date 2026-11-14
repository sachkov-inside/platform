import { glossaryTermIdSchema } from "./glossary-term-id.js";
import { mapMaterialBlockChildren, materialBlockChildren } from "./extract.js";
import type {
  RenderedBlock,
  RenderedMark,
  RenderedText,
} from "./rendered-block.js";

const termLinkPrefix = "term:";

/** The term a link points to, when the link is a `term:<id>` mention with a valid identifier. */
export function glossaryTermIdOf(href: string): string | undefined {
  if (!href.startsWith(termLinkPrefix)) return undefined;
  const id = href.slice(termLinkPrefix.length);
  return glossaryTermIdSchema.safeParse(id).success ? id : undefined;
}

/** True when the href is written as a term mention, whether or not its identifier is valid. */
export function isGlossaryTermHref(href: string): boolean {
  return href.startsWith(termLinkPrefix);
}

function inlineRuns(block: RenderedBlock): readonly RenderedText[] {
  return block.kind === "paragraph" ||
    block.kind === "heading" ||
    block.kind === "key_point"
    ? block.content
    : [];
}

function termOfMark(mark: RenderedMark): string | undefined {
  return mark.kind === "link" ? glossaryTermIdOf(mark.href) : undefined;
}

/**
 * Every Glossary Term the body mentions or shows as a definition card, once each and in document
 * order. The reader loads exactly these terms from the Glossary.
 */
export function materialGlossaryTermIds(
  blocks: readonly RenderedBlock[],
): readonly string[] {
  const ids = new Set<string>();
  const visit = (block: RenderedBlock): void => {
    if (block.kind === "term_definition") ids.add(block.termId);
    for (const run of inlineRuns(block))
      for (const mark of run.marks) {
        const id = termOfMark(mark);
        if (id !== undefined) ids.add(id);
      }
    materialBlockChildren(block).forEach(visit);
  };
  blocks.forEach(visit);
  return [...ids];
}

/**
 * Only the first mention of a term in a Material is marked: every later `term:` link of the same
 * term becomes plain text. Document order is the reading order, nested blocks included.
 */
export function keepFirstTermMentions(
  blocks: readonly RenderedBlock[],
): readonly RenderedBlock[] {
  const seen = new Set<string>();
  // One mention may span several runs when part of it carries another mark, as in
  // `[ограниченного **контекста**](term:bounded-context)`; adjacent runs of the kept link stay one.
  const inline = (content: readonly RenderedText[]): RenderedText[] => {
    let kept: string | undefined;
    return content.map((run) => {
      let runTerm: string | undefined;
      const marks = run.marks.filter((mark) => {
        const id = termOfMark(mark);
        if (id === undefined) return true;
        if (seen.has(id) && id !== kept) return false;
        seen.add(id);
        runTerm = id;
        return true;
      });
      kept = runTerm;
      return marks.length === run.marks.length ? run : { ...run, marks };
    });
  };
  const visit = (block: RenderedBlock): RenderedBlock => {
    const own =
      block.kind === "paragraph" ||
      block.kind === "heading" ||
      block.kind === "key_point"
        ? { ...block, content: inline(block.content) }
        : block;
    return mapMaterialBlockChildren(own, visit);
  };
  return blocks.map(visit);
}
