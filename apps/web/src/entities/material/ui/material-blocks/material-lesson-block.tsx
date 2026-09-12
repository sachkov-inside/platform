import type { RenderedBlock, RenderedText } from "@inside/material-blocks";
import type { ReactNode } from "react";

import { MaterialAgentPrompt } from "./material-agent-prompt.client";
import { MaterialCallout } from "./material-callout";
import { MaterialKeyPoint } from "./material-key-point";
import { MaterialLabeledList } from "./material-labeled-list";
import { MaterialModeVariant } from "./material-mode-variant.client";
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
      | "takeaways"
      | "variant";
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
   * Без него две ветки вариантного шага дали бы своим заголовкам один и тот же якорь, и ссылка
   * из оглавления вела бы в скрытую ветку.
   */
  readonly renderBlocks: (
    blocks: readonly RenderedBlock[],
    branch?: number,
  ) => ReactNode;
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
    case "variant":
      // Обе ветки рисует вызывающая поверхность и передаёт готовыми: у режима нет доступа к её
      // обходу документа, а сама ветка должна приехать в разметку, чтобы переключение было мгновенным.
      return (
        <MaterialModeVariant
          branches={block.options.map((option, index) => ({
            content: rendering.renderBlocks(option.content, index),
            mode: option.mode,
          }))}
        />
      );
  }
}
