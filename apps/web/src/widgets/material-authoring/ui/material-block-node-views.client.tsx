"use client";

import type { MaterialLabeledRow } from "@/entities/material";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { GripVertical, Plus, X } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";
import { isUnknownArray, isUnknownRecord } from "@inside/material-blocks";

const fieldClass =
  "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Рамка блока-формы: те же поля, что увидит читатель, и те же действия, что у вложения. */
function BlockForm({
  children,
  deleteNode,
  editable,
  kind,
  label,
}: {
  readonly children: ReactNode;
  readonly deleteNode: () => void;
  readonly editable: boolean;
  readonly kind: string;
  readonly label: string;
}) {
  return (
    <NodeViewWrapper
      className="group relative my-6 rounded-xl border border-border bg-card p-4"
      contentEditable={false}
      data-material-block-form={kind}
    >
      <div className="absolute right-2 top-2 z-10 flex gap-1 rounded-lg bg-card/95 p-1 focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0">
        <span aria-label="Перетащить блок" className="cursor-grab p-1" data-drag-handle>
          <GripVertical className="size-4" />
        </span>
        <button
          aria-label={`Убрать блок «${label}»`}
          className="rounded p-1 hover:bg-muted"
          disabled={!editable}
          onClick={deleteNode}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="font-mono text-[0.6875rem] text-muted-foreground">{label}</p>
      <div className="mt-3 grid gap-2">{children}</div>
    </NodeViewWrapper>
  );
}

function attributeText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Карточка внешнего ресурса: название, адрес и пояснение автор заполняет на месте. */
export function MaterialResourceCardNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
}: NodeViewProps) {
  const editable = editor.isEditable;

  return (
    <BlockForm deleteNode={deleteNode} editable={editable} kind="resourceCard" label="Ресурс">
      <input
        aria-label="Название ресурса"
        className={fieldClass}
        disabled={!editable}
        onChange={(event) => {
          updateAttributes({ title: event.currentTarget.value });
        }}
        placeholder="Название"
        value={attributeText(node.attrs.title)}
      />
      <input
        aria-label="Адрес ресурса"
        className={fieldClass}
        disabled={!editable}
        onChange={(event) => {
          updateAttributes({ url: event.currentTarget.value });
        }}
        placeholder="https://…"
        type="url"
        value={attributeText(node.attrs.url)}
      />
      <textarea
        aria-label="Описание ресурса"
        className={`${fieldClass} min-h-16 resize-y`}
        disabled={!editable}
        onChange={(event) => {
          updateAttributes({ description: event.currentTarget.value || null });
        }}
        placeholder="Зачем читателю открывать ссылку"
        value={attributeText(node.attrs.description)}
      />
    </BlockForm>
  );
}

function readRows(value: unknown): readonly MaterialLabeledRow[] {
  if (!isUnknownArray(value)) return [];
  return value.map((row) => {
    const parsed = isUnknownRecord(row) ? row : {};
    const description = attributeText(parsed.description);
    return {
      ...(description.length === 0 ? {} : { description }),
      label: attributeText(parsed.label),
      name: attributeText(parsed.name),
    };
  });
}

/** Список терминов: строки из метки, названия и пояснения. */
export function MaterialLabeledListNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
}: NodeViewProps) {
  const editable = editor.isEditable;
  const rows = readRows(node.attrs.rows);
  const writeRows = (next: readonly MaterialLabeledRow[]) => {
    updateAttributes({ rows: next.map((row) => ({ ...row })) });
  };

  return (
    <BlockForm deleteNode={deleteNode} editable={editable} kind="labeledList" label="Термины">
      {rows.map((row, index) => (
        <div
          className="grid gap-2 rounded-lg bg-muted/40 p-2 sm:grid-cols-[minmax(6rem,9rem)_1fr_auto]"
          key={index}
        >
          <input
            aria-label={`Метка строки ${String(index + 1)}`}
            className={fieldClass}
            disabled={!editable}
            onChange={(event) => {
              writeRows(
                rows.map((current, position) =>
                  position === index
                    ? { ...current, label: event.currentTarget.value }
                    : current,
                ),
              );
            }}
            placeholder="Метка"
            value={row.label}
          />
          <div className="grid gap-2">
            <input
              aria-label={`Название строки ${String(index + 1)}`}
              className={fieldClass}
              disabled={!editable}
              onChange={(event) => {
                writeRows(
                  rows.map((current, position) =>
                    position === index
                      ? { ...current, name: event.currentTarget.value }
                      : current,
                  ),
                );
              }}
              placeholder="Название"
              value={row.name}
            />
            <input
              aria-label={`Пояснение строки ${String(index + 1)}`}
              className={fieldClass}
              disabled={!editable}
              onChange={(event) => {
                const description = event.currentTarget.value;
                writeRows(
                  rows.map((current, position) => {
                    if (position !== index) return current;
                    const row = { label: current.label, name: current.name };
                    return description.length === 0 ? row : { ...row, description };
                  }),
                );
              }}
              placeholder="Пояснение"
              value={row.description ?? ""}
            />
          </div>
          <Button
            aria-label={`Убрать строку ${String(index + 1)}`}
            disabled={!editable}
            onClick={() => {
              writeRows(rows.filter((_, position) => position !== index));
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        className="justify-self-start"
        disabled={!editable}
        onClick={() => {
          writeRows([...rows, { label: "", name: "" }]);
        }}
        type="button"
        variant="secondary"
      >
        <Plus aria-hidden="true" />
        Добавить строку
      </Button>
    </BlockForm>
  );
}
