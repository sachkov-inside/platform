"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { isExerciseKind, renderedBlockSchema } from "@inside/material-blocks";
import { MaterialBodyView } from "@/entities/material";
import { MaterialResourcePlaceholder } from "@/shared/ui/material-resource-placeholder";

/**
 * Content owns Lesson Exercises. This atom shows a quiz, a match or an order read-only and keeps
 * the complete imported value on every save.
 */
export function MaterialExerciseNodeView({ node }: NodeViewProps) {
  const parsed = renderedBlockSchema.safeParse(node.attrs["exercise"]);
  if (!parsed.success || !isExerciseKind(parsed.data.kind))
    return (
      <NodeViewWrapper contentEditable={false}>
        Некорректное упражнение
      </NodeViewWrapper>
    );
  const exercise = parsed.data;
  return (
    <NodeViewWrapper contentEditable={false} data-authoring-exercise>
      <p className="text-sm text-muted-foreground">
        Упражнение редактируется в Content. Здесь можно проверить ответы.
      </p>
      <MaterialBodyView
        blocks={[exercise]}
        path={[]}
        rendering={{
          // Alone in the editor the exercise has no lesson position to show.
          exerciseNumbers: new Map(),
          headingId: (path) =>
            `authoring-exercise-${node.type.name}-${path.join("-")}`,
          image: (block) => (
            <MaterialResourcePlaceholder kind="image" alt={block.alt} />
          ),
          file: (block) => (
            <MaterialResourcePlaceholder kind="file" label={block.label} />
          ),
        }}
      />
    </NodeViewWrapper>
  );
}
