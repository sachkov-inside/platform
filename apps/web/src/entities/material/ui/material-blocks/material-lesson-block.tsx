import type { RenderedBlock, RenderedText } from "@inside/material-blocks";
import type { ReactNode } from "react";

import { MaterialAgentPrompt } from "./material-agent-prompt.client";
import { MaterialCallout } from "./material-callout";
import { MaterialKeyPoint } from "./material-key-point";
import { MaterialLabeledList } from "./material-labeled-list";
import { MaterialResourceCard } from "./material-resource-card";
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
      | "takeaways";
  }
>;

/**
 * Вложенное содержимое рисует вызывающая поверхность: у читателя и у предпросмотра свои отступы,
 * свои ключи и свой обход документа.
 */
export interface LessonBlockRendering {
  readonly renderBlock: (block: RenderedBlock, index: number) => ReactNode;
  readonly renderBlocks: (blocks: readonly RenderedBlock[]) => ReactNode;
  readonly renderInline: (content: readonly RenderedText[]) => ReactNode;
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
    case "callout":
      return (
        <MaterialCallout title={block.title} tone={block.tone}>
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
          items={block.content.map((item, index) => rendering.renderBlock(item, index))}
          title={block.title}
        />
      );
    case "labeled_list":
      return <MaterialLabeledList rows={block.rows} />;
    case "key_point":
      return <MaterialKeyPoint>{rendering.renderInline(block.content)}</MaterialKeyPoint>;
  }
}
