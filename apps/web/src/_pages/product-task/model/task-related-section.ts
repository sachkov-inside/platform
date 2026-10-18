import type { RenderedBlock } from "@/entities/material.model";

/** Move only the authored related section; retain every block, its original index and section boundary. */
export function taskRelatedSectionRange(
  blocks: readonly RenderedBlock[],
): { readonly start: number; readonly end: number } | undefined {
  const start = blocks.findIndex(
    (block) =>
      block.kind === "heading" &&
      block.content.map((part) => part.text).join("") === "Материалы к заданию",
  );
  const heading = blocks[start];
  if (heading?.kind !== "heading") return undefined;
  const following = blocks.findIndex(
    (block, index) =>
      index > start && block.kind === "heading" && block.level <= heading.level,
  );
  const end = following === -1 ? blocks.length : following;
  return { start, end };
}

export function taskRelatedSectionOrder(
  blocks: readonly RenderedBlock[],
): readonly number[] | undefined {
  const section = taskRelatedSectionRange(blocks);
  if (section === undefined) return undefined;
  const { start, end } = section;
  const indices = blocks.map((_, index) => index);
  return [
    ...indices.slice(start, end),
    ...indices.slice(0, start),
    ...indices.slice(end),
  ];
}
