import type { RenderedBlock } from "@inside/material-blocks";

export interface MaterialTableName {
  readonly number: number;
  readonly total: number;
  readonly orderScopes: readonly string[];
}

export interface OrderTableRange {
  readonly stepId: string;
  readonly start: number;
  readonly count: number;
}

export interface MaterialTableNames {
  readonly tables: ReadonlyMap<string, MaterialTableName>;
  readonly orders: ReadonlyMap<string, readonly OrderTableRange[]>;
}

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
): MaterialTableNames {
  const tables: { path: string; orderScopes: readonly string[] }[] = [];
  const orders = new Map<string, readonly OrderTableRange[]>();
  function visit(
    children: readonly RenderedBlock[],
    parent: readonly number[],
    orderScopes: readonly string[] = [],
  ) {
    children.forEach((block, index) =>
      visitBlock(block, [...parent, index], orderScopes),
    );
  }
  function visitBlock(
    block: RenderedBlock,
    at: readonly number[],
    orderScopes: readonly string[] = [],
  ) {
    switch (block.kind) {
      case "table":
        tables.push({ path: at.join("-"), orderScopes });
        block.rows.forEach((row, r) => {
          row.cells.forEach((cell, c) =>
            visit(cell.content, [...at, r, c], orderScopes),
          );
        });
        break;
      case "blockquote":
      case "callout":
      case "takeaways":
        visit(block.content, at, orderScopes);
        break;
      case "bullet_list":
      case "ordered_list":
        block.items.forEach((item, branch) =>
          visit(item, [...at, branch], orderScopes),
        );
        break;
      case "quiz":
      case "match":
      case "order": {
        let branch = 0;
        const rich = (
          content: readonly RenderedBlock[],
          scopes = orderScopes,
        ) => {
          visit(content, [...at, branch++], scopes);
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
        else {
          const ranges: OrderTableRange[] = [];
          block.steps.forEach((step) => {
            const start = tables.length + 1;
            const scopes = [...orderScopes, at.join("-")];
            rich(step.content, scopes);
            rich(step.explanation, scopes);
            ranges.push({
              stepId: step.id,
              start,
              count: tables.length + 1 - start,
            });
          });
          orders.set(at.join("-"), ranges);
        }
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
  return {
    tables: new Map(
      tables.map((table, index) => [
        table.path,
        {
          number: index + 1,
          total: tables.length,
          orderScopes: table.orderScopes,
        },
      ]),
    ),
    orders,
  };
}
