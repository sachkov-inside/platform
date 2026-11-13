"use client";

import { useEditorState, type Editor } from "@tiptap/react";

import {
  calloutTones,
  calloutTonePresentation,
  type CalloutTone,
} from "@/entities/material";
import { Button } from "@/shared/ui/button";

const titleFieldClass =
  "min-h-9 w-40 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56";

/** Всё, что показывает панель текущего блока. Панель пересобирается, когда меняется это, а не на каждой транзакции. */
type BlockFieldsState =
  | {
      readonly kind: "callout";
      readonly title: string;
      readonly tone: CalloutTone;
    }
  | { readonly kind: "takeaways"; readonly title: string }
  | { readonly kind: "agentPrompt"; readonly title: string }
  | { readonly kind: "none" };

function blockFieldsState(editor: Editor): BlockFieldsState {
  const tone = calloutTones.find((candidate) =>
    editor.isActive("callout", { kind: candidate }),
  );
  if (tone !== undefined)
    return { kind: "callout", title: blockTitle(editor, "callout"), tone };
  if (editor.isActive("takeaways"))
    return { kind: "takeaways", title: blockTitle(editor, "takeaways") };
  if (editor.isActive("agentPrompt"))
    return { kind: "agentPrompt", title: blockTitle(editor, "agentPrompt") };
  return { kind: "none" };
}

function blockTitle(editor: Editor, type: string): string {
  const value: unknown = editor.getAttributes(type)["title"];
  return typeof value === "string" ? value : "";
}

function BlockTitleField({
  disabled,
  editor,
  label,
  placeholder,
  required,
  type,
  value,
}: {
  readonly disabled: boolean;
  readonly editor: Editor;
  readonly label: string;
  readonly placeholder: string;
  /** Обязательное название хранится пустой строкой, необязательное — отсутствует. */
  readonly required: boolean;
  readonly type: string;
  readonly value: string;
}) {
  return (
    <input
      aria-label={label}
      className={titleFieldClass}
      disabled={disabled}
      onChange={(event) => {
        const title = event.currentTarget.value;
        editor.commands.updateAttributes(type, {
          title: required || title.length > 0 ? title : null,
        });
      }}
      placeholder={placeholder}
      value={value}
    />
  );
}

/**
 * Поля текущего блока. Вид врезки и названия нельзя набрать в тексте, поэтому автор меняет их
 * здесь — тем же способом, каким уже правит таблицу.
 */
export function MaterialBlockFields({
  disabled,
  editor,
}: {
  readonly disabled: boolean;
  readonly editor: Editor;
}) {
  const fields = useEditorState({
    editor,
    selector: ({ editor: current }) => blockFieldsState(current),
  });

  if (fields.kind === "callout") {
    return (
      <div
        aria-label="Врезка"
        className="mr-auto flex min-w-0 flex-wrap items-center gap-1"
        role="toolbar"
      >
        {calloutTones.map((option) => {
          const presentation = calloutTonePresentation(option);
          return (
            <Button
              aria-label={`Вид врезки: ${presentation.label}`}
              aria-pressed={option === fields.tone}
              disabled={disabled}
              key={option}
              onClick={() => {
                editor.commands.updateAttributes("callout", { kind: option });
              }}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              size="icon"
              title={presentation.label}
              type="button"
              variant={option === fields.tone ? "secondary" : "ghost"}
            >
              <presentation.icon aria-hidden="true" />
            </Button>
          );
        })}
        <BlockTitleField
          disabled={disabled}
          editor={editor}
          label="Название врезки"
          placeholder="Название, необязательно"
          required={false}
          type="callout"
          value={fields.title}
        />
      </div>
    );
  }

  if (fields.kind === "takeaways") {
    return (
      <div
        aria-label="Итоги"
        className="mr-auto flex min-w-0 items-center"
        role="toolbar"
      >
        <BlockTitleField
          disabled={disabled}
          editor={editor}
          label="Заголовок итогов"
          placeholder="Заголовок итогов"
          required
          type="takeaways"
          value={fields.title}
        />
      </div>
    );
  }

  if (fields.kind === "agentPrompt") {
    return (
      <div
        aria-label="Промпт"
        className="mr-auto flex min-w-0 items-center"
        role="toolbar"
      >
        <BlockTitleField
          disabled={disabled}
          editor={editor}
          label="Заголовок промпта"
          placeholder="Заголовок, необязательно"
          required={false}
          type="agentPrompt"
          value={fields.title}
        />
      </div>
    );
  }

  return null;
}
