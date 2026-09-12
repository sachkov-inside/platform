"use client";

import type { Editor } from "@tiptap/react";

import {
  calloutTones,
  calloutTonePresentation,
  type CalloutTone,
} from "@/entities/material";
import { guideModeLabels, guideModes, type GuideMode } from "@/shared/guide-mode";
import { Button } from "@/shared/ui/button";

const titleFieldClass =
  "min-h-9 w-40 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-56";

function activeTone(editor: Editor): CalloutTone | undefined {
  return calloutTones.find((tone) => editor.isActive("callout", { kind: tone }));
}

function blockTitle(editor: Editor, type: string): string {
  const value: unknown = editor.getAttributes(type).title;
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
      value={blockTitle(editor, type)}
    />
  );
}

function activeVariantMode(editor: Editor): GuideMode | undefined {
  return guideModes.find((mode) => editor.isActive("variantOption", { mode }));
}

/** Вариантный блок под курсором: сколько в нём веток и где он кончается. */
function variantUnderCursor(
  editor: Editor,
):
  | {
      readonly end: number;
      /** Позиция каждой ветки в документе, в порядке веток. */
      readonly branchPositions: readonly number[];
    }
  | undefined {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "variant") continue;
    const positions: number[] = [];
    let position = $from.start(depth);
    node.forEach((child) => {
      positions.push(position);
      position += child.nodeSize;
    });
    return { branchPositions: positions, end: $from.end(depth) };
  }
  return undefined;
}

/**
 * Назначает ветке режим. Когда этот режим уже занят соседней веткой, ветки меняются режимами:
 * две ветки одного режима — документ, который отвергло бы каждое автосохранение, и автор не
 * должен уметь завести его одним нажатием.
 */
function selectBranchMode(
  editor: Editor,
  mode: GuideMode,
  currentMode: GuideMode,
): void {
  const cursor = editor.state.selection.$from.pos;
  const branches = (variantUnderCursor(editor)?.branchPositions ?? []).map(
    (position) => {
      const node = editor.state.doc.nodeAt(position);
      const mode: unknown = node?.attrs.mode;
      return { mode, position, size: node?.nodeSize ?? 0 };
    },
  );
  const branchPosition = branches.find(
    (branch) => branch.position <= cursor && cursor <= branch.position + branch.size,
  )?.position;
  const occupied = branches.find(
    (branch) => branch.position !== branchPosition && branch.mode === mode,
  )?.position;
  if (branchPosition === undefined || occupied === undefined) {
    editor.commands.updateAttributes("variantOption", { mode });
    return;
  }
  editor.commands.command(({ dispatch, tr }) => {
    if (dispatch) {
      tr.setNodeAttribute(occupied, "mode", currentMode);
      tr.setNodeAttribute(branchPosition, "mode", mode);
    }
    return true;
  });
}

/**
 * Ветка вариантного блока: её режим нельзя набрать текстом, а второй вариант нужно откуда-то
 * завести. Оба действия стоят здесь же, где автор уже меняет вид врезки.
 */
function VariantFields({
  branchMode,
  disabled,
  editor,
}: {
  readonly branchMode: GuideMode;
  readonly disabled: boolean;
  readonly editor: Editor;
}) {
  const variant = variantUnderCursor(editor);
  const branches = variant?.branchPositions.length ?? 0;
  const missing = guideModes.find((mode) => mode !== branchMode);

  return (
    <div
      aria-label="Вариант шага"
      className="mr-auto flex min-w-0 flex-wrap items-center gap-1"
      role="toolbar"
    >
      {guideModes.map((mode) => (
        <Button
          aria-label={`Режим ветки: ${guideModeLabels[mode]}`}
          aria-pressed={mode === branchMode}
          disabled={disabled}
          key={mode}
          onClick={() => {
            if (mode === branchMode) return;
            selectBranchMode(editor, mode, branchMode);
          }}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          type="button"
          variant={mode === branchMode ? "secondary" : "ghost"}
        >
          {guideModeLabels[mode]}
        </Button>
      ))}
      {branches > 1 || missing === undefined ? null : (
        <Button
          disabled={disabled}
          onClick={() => {
            if (variant === undefined) return;
            editor
              .chain()
              .focus()
              .insertContentAt(variant.end, {
                type: "variantOption",
                attrs: { mode: missing },
                content: [{ type: "paragraph" }],
              })
              .run();
          }}
          type="button"
          variant="secondary"
        >
          Добавить «{guideModeLabels[missing]}»
        </Button>
      )}
      {branches < 2 ? null : (
        <Button
          disabled={disabled}
          onClick={() => {
            editor.chain().focus().deleteNode("variantOption").run();
          }}
          type="button"
          variant="ghost"
        >
          Убрать эту ветку
        </Button>
      )}
    </div>
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
        {calloutTones.map((option) => {
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

  const branchMode = activeVariantMode(editor);
  if (branchMode !== undefined) {
    return (
      <VariantFields branchMode={branchMode} disabled={disabled} editor={editor} />
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
