"use client";

import type { Editor } from "@tiptap/react";

import {
  calloutToneOrder,
  calloutTonePresentation,
  type CalloutTone,
} from "@/entities/material";
import { Button } from "@/shared/ui/button";

const titleFieldClass =
  "min-h-9 w-40 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56";

function activeTone(editor: Editor): CalloutTone | undefined {
  return calloutToneOrder.find((tone) => editor.isActive("callout", { kind: tone }));
}

function attributeText(editor: Editor, type: string, name: string): string {
  const value: unknown = editor.getAttributes(type)[name];
  return typeof value === "string" ? value : "";
}

function BlockTitleField({
  disabled,
  editor,
  label,
  placeholder,
  required,
  type,
}: {
  readonly disabled: boolean;
  readonly editor: Editor;
  readonly label: string;
  readonly placeholder: string;
  /** Обязательное название хранится пустой строкой, необязательное — отсутствует. */
  readonly required: boolean;
  readonly type: string;
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
      value={attributeText(editor, type, "title")}
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
  const tone = activeTone(editor);

  if (tone !== undefined) {
    return (
      <div
        aria-label="Врезка"
        className="mr-auto flex min-w-0 flex-wrap items-center gap-1"
        role="toolbar"
      >
        {calloutToneOrder.map((option) => {
          const presentation = calloutTonePresentation(option);
          return (
            <Button
              aria-label={`Вид врезки: ${presentation.label}`}
              aria-pressed={option === tone}
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
              variant={option === tone ? "secondary" : "ghost"}
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
        />
      </div>
    );
  }

  if (editor.isActive("takeaways")) {
    return (
      <div aria-label="Итоги" className="mr-auto flex min-w-0 items-center" role="toolbar">
        <BlockTitleField
          disabled={disabled}
          editor={editor}
          label="Заголовок итогов"
          placeholder="Заголовок итогов"
          required
          type="takeaways"
        />
      </div>
    );
  }

  if (editor.isActive("agentPrompt")) {
    return (
      <div aria-label="Промпт" className="mr-auto flex min-w-0 items-center" role="toolbar">
        <BlockTitleField
          disabled={disabled}
          editor={editor}
          label="Заголовок промпта"
          placeholder="Заголовок, необязательно"
          required={false}
          type="agentPrompt"
        />
      </div>
    );
  }

  return null;
}
