import type { EditorState } from "@tiptap/pm/state";

/** Вариантный шаг под курсором и его ветки в порядке документа. */
export interface VariantUnderCursor {
  /** Позиция каждой ветки в документе. */
  readonly branchPositions: readonly number[];
  /** Позиция ветки, в которой стоит курсор. */
  readonly currentBranch: number;
  /** Конец блока: туда встаёт недостающая ветка. */
  readonly end: number;
}

/**
 * Находит вариантный шаг под курсором и ветку, в которой курсор стоит.
 *
 * Ветка определяется разрешённой позицией, а не попаданием в отрезок: выделение целого узла стоит
 * ровно на границе двух веток, и отрезок отдал бы соседнюю. Ошибка была бы не видна сразу — автор
 * получил бы две ветки одного режима, то есть материал, который перестал сохраняться.
 */
export function variantUnderCursor(
  state: EditorState,
): VariantUnderCursor | undefined {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "variant") continue;
    const positions: number[] = [];
    let position = $from.start(depth);
    node.forEach((child) => {
      positions.push(position);
      position += child.nodeSize;
    });
    const currentBranch =
      $from.node(depth + 1)?.type.name === "variantOption"
        ? $from.before(depth + 1)
        : $from.nodeAfter?.type.name === "variantOption"
          ? $from.pos
          : undefined;
    if (currentBranch === undefined) return undefined;
    return { branchPositions: positions, currentBranch, end: $from.end(depth) };
  }
  return undefined;
}
