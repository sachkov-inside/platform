"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { renderedBlockSchema } from "@inside/material-blocks";
import { MaterialBodyView } from "@/entities/material";
import { MaterialResourcePlaceholder } from "@/shared/ui/material-resource-placeholder";

/** Content owns quiz editing. This atom preserves the complete imported value on every save. */
export function MaterialQuizNodeView({ node }: NodeViewProps) {
  const parsed = renderedBlockSchema.safeParse(node.attrs["quiz"]);
  if (!parsed.success || parsed.data.kind !== "quiz")
    return (
      <NodeViewWrapper contentEditable={false}>
        Некорректный квиз
      </NodeViewWrapper>
    );
  const quiz = parsed.data;
  return (
    <NodeViewWrapper contentEditable={false} data-authoring-quiz>
      <p className="text-sm text-muted-foreground">
        Квиз редактируется в Content. Здесь можно проверить ответы.
      </p>
      <MaterialBodyView
        blocks={[quiz]}
        path={[]}
        rendering={{
          headingId: (path) => `authoring-quiz-${quiz.id}-${path.join("-")}`,
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
