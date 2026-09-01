"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Bold, Heading2, Italic, List, ListOrdered } from "lucide-react";
import {
  useEffect,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";

import { Button } from "@/shared/ui/button";

import type {
  MaterialAuthoringActions,
  MaterialAuthoringPresentation,
} from "../model/presentation";
import {
  MaterialAssetFileNode,
  MaterialAssetImageNode,
} from "../model/material-asset-nodes";
import {
  MaterialAssetUploadButtons,
  MaterialAssetUploadQueue,
  useMaterialAssetUploads,
} from "./material-asset-upload-controls.client";

export function MaterialDocumentEditor({
  disabled,
  document,
  materialId,
  onChange,
}: {
  readonly disabled: boolean;
  readonly document: MaterialAuthoringPresentation["draft"]["document"];
  readonly materialId: string | null;
  readonly onChange: MaterialAuthoringActions["onDocumentChange"];
}) {
  const editor = useEditor({
    content: document,
    editable: !disabled,
    extensions: [StarterKit, MaterialAssetImageNode, MaterialAssetFileNode],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-labelledby": "document-heading",
        "aria-multiline": "true",
        id: "material-body",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getJSON());
    },
  });
  const assetUploads = useMaterialAssetUploads(editor, materialId);

  useEffect(() => {
    if (editor !== null && editor.isEditable !== !disabled) {
      editor.setEditable(!disabled);
    }
  }, [disabled, editor]);

  if (editor === null) {
    return (
      <div
        className="mt-5 min-h-80 animate-pulse rounded-xl bg-muted motion-reduce:animate-none"
        role="status"
      >
        Подготовка редактора…
      </div>
    );
  }

  return (
    <div className="mt-5 overflow-clip rounded-xl border border-border bg-card focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
      <div
        aria-label="Форматирование"
        className="flex flex-wrap gap-1 border-b border-border bg-muted/65 p-2"
        role="toolbar"
      >
        <ToolbarButton active={editor.isActive("bold")} disabled={disabled} label="Полужирный" onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("italic")} disabled={disabled} label="Курсив" onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("heading", { level: 2 })} disabled={disabled} label="Заголовок второго уровня" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("bulletList")} disabled={disabled} label="Маркированный список" onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton active={editor.isActive("orderedList")} disabled={disabled} label="Нумерованный список" onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered aria-hidden="true" />
        </ToolbarButton>
        <MaterialAssetUploadButtons
          controller={assetUploads}
          disabled={disabled || materialId === null}
        />
      </div>
      <MaterialAssetUploadQueue controller={assetUploads} />
      {materialId === null ? (
        <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          Сначала создайте черновик, затем добавляйте файлы и изображения.
        </p>
      ) : null}
      <EditorContent
        className="[&_.ProseMirror]:min-h-[30rem] [&_.ProseMirror]:px-5 [&_.ProseMirror]:py-6 [&_.ProseMirror]:text-[1rem] [&_.ProseMirror]:leading-[1.75] [&_.ProseMirror]:outline-none [&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-8 [&_.ProseMirror_h2]:text-2xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:tracking-[-0.025em] [&_.ProseMirror_li]:my-1 [&_.ProseMirror_ol]:ml-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_p]:my-4 [&_.ProseMirror_ul]:ml-6 [&_.ProseMirror_ul]:list-disc [&_.material-asset-node]:my-5 [&_.material-asset-node]:grid [&_.material-asset-node]:gap-1 [&_.material-asset-node]:rounded-xl [&_.material-asset-node]:border [&_.material-asset-node]:border-border [&_.material-asset-node]:bg-muted/50 [&_.material-asset-node]:p-4 [&_.material-asset-node__kind]:font-mono [&_.material-asset-node__kind]:text-xs [&_.material-asset-node__kind]:text-muted-foreground [&_.material-asset-node__label]:font-semibold sm:[&_.ProseMirror]:px-8 sm:[&_.ProseMirror]:py-8"
        editor={editor}
        onDropCapture={(event: DragEvent<HTMLDivElement>) => {
          const files = Array.from(event.dataTransfer.files);
          if (files.length === 0 || disabled || materialId === null) return;
          event.preventDefault();
          const coordinates = editor.view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          });
          assetUploads.enqueue(files, undefined, coordinates?.pos);
        }}
        onPasteCapture={(event: ClipboardEvent<HTMLDivElement>) => {
          const files = Array.from(event.clipboardData.files);
          if (files.length === 0 || disabled || materialId === null) return;
          event.preventDefault();
          assetUploads.enqueue(files);
        }}
      />
    </div>
  );
}

function ToolbarButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <Button aria-label={label} aria-pressed={active} className="size-11 sm:size-9" disabled={disabled} onClick={onClick} size="icon-lg" type="button" variant={active ? "secondary" : "ghost"}>
      {children}
    </Button>
  );
}
