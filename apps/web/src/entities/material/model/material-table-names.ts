import type { RenderedBlock } from "@inside/material-blocks";

export function bodyBlockIndices(
  blocks: readonly RenderedBlock[],
  order?: readonly number[],
): number[] {
  const indices = blocks.map((_, index) => index);
  if (order === undefined) return indices;
  const positions = new Map(order.map((index, position) => [index, position]));
  return indices.sort(
    (left, right) =>
      (positions.get(left) ?? order.length + left) -
      (positions.get(right) ?? order.length + right),
  );
}

/** Document positions keep names deterministic across SSR and hydration (#2408). */
export function materialTableNames(
  blocks: readonly RenderedBlock[],
  path: readonly number[],
  order?: readonly number[],
  comparison?: { readonly at: number; readonly labels: readonly string[] },
): ReadonlyMap<string, string> {
  const tables: string[] = [];
  function visit(
    children: readonly RenderedBlock[],
    parent: readonly number[],
  ) {
    children.forEach((block, index) => visitBlock(block, [...parent, index]));
  }
  function visitBlock(block: RenderedBlock, at: readonly number[]) {
    switch (block.kind) {
      case "table":
        tables.push(at.join("-"));
        block.rows.forEach((row, r) => {
          row.cells.forEach((cell, c) => visit(cell.content, [...at, r, c]));
        });
        break;
      case "blockquote":
      case "callout":
      case "takeaways":
        visit(block.content, at);
        break;
      case "bullet_list":
      case "ordered_list":
        block.items.forEach((item, branch) => visit(item, [...at, branch]));
        break;
      case "quiz":
      case "match":
      case "order": {
        let branch = 0;
        const rich = (content: readonly RenderedBlock[]) => {
          visit(content, [...at, branch++]);
        };
        if (block.context !== undefined) rich(block.context);
        rich(block.question);
        if (block.kind === "quiz")
          block.options.forEach((option) => {
            rich(option.content);
            if (option.explanation !== undefined) rich(option.explanation);
          });
        else if (block.kind === "match")
          block.rows.forEach((row) => {
            rich(row.content);
            rich(row.explanation);
          });
        else
          block.steps.forEach((step) => {
            rich(step.content);
            rich(step.explanation);
          });
        if (block.dontKnow !== undefined) rich(block.dontKnow.explanation);
        break;
      }
    }
  }
  for (const index of bodyBlockIndices(blocks, order)) {
    const block = blocks[index];
    if (block === undefined) continue;
    if (index === comparison?.at) {
      comparison.labels.forEach((_, offset) => {
        const card = blocks[index + offset];
        if (card?.kind === "callout" && card.title !== undefined)
          visit(card.content, [...path, index + offset]);
      });
    } else if (
      comparison === undefined ||
      index < comparison.at ||
      index >= comparison.at + comparison.labels.length
    )
      visitBlock(block, [...path, index]);
  }
  return new Map(
    tables.map((table, index) => [
      table,
      tables.length === 1
        ? "Таблица в материале"
        : `Таблица ${String(index + 1)} в материале`,
    ]),
  );
}
