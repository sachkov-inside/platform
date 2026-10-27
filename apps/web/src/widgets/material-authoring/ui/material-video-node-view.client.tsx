"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { GripVertical, Plus, Video, X } from "lucide-react";
import {
  isUnknownArray,
  isUnknownRecord,
  videoChaptersSchema,
} from "@inside/material-blocks";

import { Button } from "@/shared/ui/button";

const fieldClass =
  "w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The block selects placement and context. Attachment and upload remain in the Video panel. */
export function MaterialVideoNodeView({
  node,
  editor,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const raw: unknown = node.attrs["chapters"];
  const chapters = isUnknownArray(raw)
    ? raw.filter(isUnknownRecord).map((chapter) => ({
        start: typeof chapter["start"] === "number" ? chapter["start"] : 0,
        title: typeof chapter["title"] === "string" ? chapter["title"] : "",
      }))
    : [];
  const description: unknown = node.attrs["description"];
  const editable = editor.isEditable;
  const write = (next: typeof chapters) => updateAttributes({ chapters: next });
  return (
    <NodeViewWrapper
      className="my-8 rounded-xl border border-border bg-card p-4 sm:p-5"
      contentEditable={false}
      data-material-block-form="video"
    >
      <div className="flex items-center gap-3">
        <span
          aria-label="Перетащить видео"
          className="cursor-grab p-2"
          data-drag-handle
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </span>
        <Video aria-hidden="true" className="size-5" />
        <p className="flex-1 font-semibold">Видео материала</p>
        <Button
          aria-label="Убрать блок видео"
          disabled={!editable}
          onClick={deleteNode}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X />
        </Button>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        Прикрепите запись в разделе «Видео». Плеер появится здесь. Блок можно
        переместить между абзацами.
      </p>
      <label className="mt-4 grid gap-2 text-sm">
        Описание видео
        <textarea
          className={`${fieldClass} min-h-20 resize-y`}
          disabled={!editable}
          value={typeof description === "string" ? description : ""}
          onChange={(event) =>
            updateAttributes({ description: event.currentTarget.value || null })
          }
        />
      </label>
      <fieldset className="mt-5 min-w-0">
        <legend className="text-sm font-semibold">Таймкоды</legend>
        {chapters.map((chapter, index) => (
          <div className="mt-3 flex items-end gap-2" key={index}>
            <label className="grid w-24 shrink-0 gap-1 text-xs">
              Секунды
              <input
                aria-label={`Начало главы ${String(index + 1)}, секунды`}
                className={fieldClass}
                disabled={!editable}
                min={0}
                step={1}
                type="number"
                value={chapter.start}
                onChange={(event) =>
                  write(
                    chapters.map((item, position) =>
                      position === index
                        ? { ...item, start: Number(event.currentTarget.value) }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <label className="grid min-w-0 flex-1 gap-1 text-xs">
              Название
              <input
                aria-label={`Название главы ${String(index + 1)}`}
                className={fieldClass}
                disabled={!editable}
                maxLength={200}
                value={chapter.title}
                onChange={(event) =>
                  write(
                    chapters.map((item, position) =>
                      position === index
                        ? { ...item, title: event.currentTarget.value }
                        : item,
                    ),
                  )
                }
              />
            </label>
            <Button
              aria-label={`Убрать главу ${String(index + 1)}`}
              disabled={!editable}
              onClick={() =>
                write(chapters.filter((_, position) => position !== index))
              }
              size="icon"
              type="button"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        ))}
        {videoChaptersSchema.safeParse(chapters).success ? null : (
          <p className="mt-2 text-sm text-destructive" role="alert">
            Укажите названия и время по возрастанию, без повторов.
          </p>
        )}
        <Button
          className="mt-3"
          disabled={!editable || chapters.length >= 200}
          onClick={() =>
            write([
              ...chapters,
              {
                start: (chapters.at(-1)?.start ?? -60) + 60,
                title: "Новая глава",
              },
            ])
          }
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" />
          Добавить таймкод
        </Button>
      </fieldset>
    </NodeViewWrapper>
  );
}
