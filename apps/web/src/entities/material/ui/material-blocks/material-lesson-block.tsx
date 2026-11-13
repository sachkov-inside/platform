import type {
  MaterialExerciseNumber,
  RenderedBlock,
  RenderedText,
} from "@inside/material-blocks";
import type { ReactNode } from "react";

import { MaterialAgentPrompt } from "./material-agent-prompt.client";
import { MaterialCallout } from "./material-callout";
import { MaterialKeyPoint } from "./material-key-point";
import { MaterialLabeledList } from "./material-labeled-list";
import { MaterialResourceCard } from "./material-resource-card";
import { exerciseHeading } from "./material-exercise-frame";
import { MaterialMatch, MaterialOrder } from "./material-match-order";
import { MaterialQuiz } from "./material-quiz.client";
import { MaterialTakeaways } from "./material-takeaways";

/** Блоки, внешний вид которых принадлежит этому модулю. */
export type LessonBlock = Extract<
  RenderedBlock,
  {
    kind:
      | "agent_prompt"
      | "callout"
      | "key_point"
      | "labeled_list"
      | "resource_card"
      | "takeaways"
      | "quiz"
      | "match"
      | "order";
  }
>;

/**
 * Вложенное содержимое рисует вызывающая поверхность: у читателя и у предпросмотра свои отступы,
 * свои ключи и свой обход документа.
 */
export interface LessonBlockRendering {
  readonly renderBlock: (block: RenderedBlock, index: number) => ReactNode;
  /**
   * `branch` разводит несколько вложенных последовательностей одного блока по разным адресам.
   * Без него вариант ответа квиза и его разбор дали бы своим заголовкам один и тот же якорь.
   */
  readonly renderBlocks: (
    blocks: readonly RenderedBlock[],
    branch?: number,
  ) => ReactNode;
  readonly renderInline: (content: readonly RenderedText[]) => ReactNode;
  /** Position of an exercise in its lesson; unknown in a surface that shows it alone. */
  readonly exerciseNumber?:
    ((exerciseId: string) => MaterialExerciseNumber | undefined) | undefined;
}

/** Один блок урока. Читатель, предпросмотр и редактор показывают его одинаково. */
export function MaterialLessonBlock({
  block,
  rendering,
}: {
  readonly block: LessonBlock;
  readonly rendering: LessonBlockRendering;
}) {
  switch (block.kind) {
    case "quiz":
    case "match":
    case "order": {
      // Every rich sequence gets its own branch, so headings inside them get their own anchors.
      let branch = 0;
      const rich = (blocks: readonly RenderedBlock[]) =>
        rendering.renderBlocks(blocks, branch++);
      const common = {
        id: block.id,
        heading: exerciseHeading(rendering.exerciseNumber?.(block.id)),
        ...(block.context === undefined
          ? {}
          : { context: rich(block.context) }),
        question: rich(block.question),
      };
      if (block.kind === "match")
        return (
          <MaterialMatch
            {...common}
            rows={block.rows.map((row) => ({
              id: row.id,
              content: rich(row.content),
            }))}
            choices={block.choices.map((choice) => ({
              id: choice.id,
              content: rich(choice.content),
            }))}
          />
        );
      if (block.kind === "order")
        return (
          <MaterialOrder
            {...common}
            steps={block.steps.map((step) => ({
              id: step.id,
              content: rich(step.content),
            }))}
          />
        );
      return (
        <MaterialQuiz
          key={block.id}
          {...common}
          selectionMode={block.selectionMode}
          options={block.options.map((option) => ({
            id: option.id,
            content: rich(option.content),
            correct: option.correct,
            ...(option.explanation === undefined
              ? {}
              : { explanation: rich(option.explanation) }),
          }))}
          {...(block.dontKnow === undefined
            ? {}
            : {
                dontKnow: {
                  explanation: rich(block.dontKnow.explanation),
                  reviewLinks: block.dontKnow.reviewLinks,
                },
              })}
        />
      );
    }
    case "callout":
      return (
        <MaterialCallout
          collapse={block.collapse}
          title={block.title}
          tone={block.tone}
        >
          {rendering.renderBlocks(block.content)}
        </MaterialCallout>
      );
    case "resource_card":
      return (
        <MaterialResourceCard
          description={block.description}
          title={block.title}
          url={block.url}
        />
      );
    case "agent_prompt":
      return <MaterialAgentPrompt text={block.text} title={block.title} />;
    case "takeaways":
      return (
        <MaterialTakeaways
          items={block.content.map((item, index) =>
            rendering.renderBlock(item, index),
          )}
          title={block.title}
        />
      );
    case "labeled_list":
      return <MaterialLabeledList rows={block.rows} />;
    case "key_point":
      return (
        <MaterialKeyPoint>
          {rendering.renderInline(block.content)}
        </MaterialKeyPoint>
      );
  }
}
