"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Plus,
  Quote,
  Code2,
  Minus,
  Type,
  Table2,
  Info,
  Link2,
} from "lucide-react";
import {
  useEffect,
  useState,
  useRef,
  useCallback,
  type ClipboardEvent,
  type DragEvent,
  type ReactNode,
} from "react";

import { EditorAssetContext } from "./material-asset-node-view.client";
import { Button } from "@/shared/ui/button";

import type {
  MaterialAuthoringActions,
  MaterialAuthoringPresentation,
} from "../model/presentation";
import { materialDocumentExtensions } from "../model/material-document-extensions";
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
  contentVersion = null,
  assetPreviewBlocks = [],
}: {
  readonly contentVersion?: number | null;
  readonly assetPreviewBlocks?: MaterialAuthoringPresentation["draft"]["assetPreviewBlocks"];
  readonly disabled: boolean;
  readonly document: MaterialAuthoringPresentation["draft"]["document"];
  readonly materialId: string | null;
  readonly onChange: MaterialAuthoringActions["onDocumentChange"];
}) {
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const imageUrls = useRef(new Map<string, string>());
  const [localImages, setLocalImages] = useState<
    Readonly<Record<string, string>>
  >({});
  const imageReady = useCallback((assetId: string, file: File) => {
    const previous = imageUrls.current.get(assetId);
    if (previous) URL.revokeObjectURL(previous);
    const url = URL.createObjectURL(file);
    imageUrls.current.set(assetId, url);
    setLocalImages(Object.fromEntries(imageUrls.current));
  }, []);
  useEffect(
    () => () => {
      for (const url of imageUrls.current.values()) URL.revokeObjectURL(url);
    },
    [],
  );
  const expand = () => {
    const window = dialog.current;
    if (!window) return;
    window.close();
    if (expanded) window.show();
    else window.showModal();
    setExpanded(!expanded);
  };
  const editor = useEditor({
    content: document,
    editable: !disabled,
    extensions: materialDocumentExtensions,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      handleKeyDown(view, event) {
        if (
          event.key === "/" &&
          view.state.selection.$from.parent.textContent.trim() === ""
        ) {
          setMenuOpen(true);
          setMenuSearch("");
          return true;
        }
        return false;
      },
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
  const assetUploads = useMaterialAssetUploads(editor, materialId, imageReady);

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

  const blocks = [
    {
      name: "Текст",
      icon: Type,
      run: () => editor.chain().focus().setParagraph().run(),
    },
    {
      name: "Заголовок H2",
      icon: Heading2,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      name: "Заголовок H3",
      icon: Heading3,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      name: "Список",
      icon: List,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      name: "Нумерованный список",
      icon: ListOrdered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      name: "Цитата",
      icon: Quote,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      name: "Код",
      icon: Code2,
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      name: "Разделитель",
      icon: Minus,
      run: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      name: "Таблица",
      icon: Table2,
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      name: "Примечание",
      icon: Info,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: { kind: "note" },
            content: [{ type: "paragraph" }],
          })
          .run(),
    },
    {
      name: "Ссылка",
      icon: Link2,
      run: () => {
        setLinkOpen(true);
        setLinkUrl("");
        setLinkInvalid(false);
      },
    },
  ];
  return (
    <dialog
      open
      ref={dialog}
      aria-label="Редактор статьи"
      onCancel={(event) => {
        if (expanded) {
          event.preventDefault();
          expand();
        }
      }}
      className={
        expanded
          ? "fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto border-0 bg-background p-0 text-foreground backdrop:bg-black/40"
          : "relative m-0 mt-5 block w-full min-w-0 max-w-none overflow-visible rounded-2xl border border-border bg-card p-0 text-foreground"
      }
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-3 py-2">
        <span className="px-2 text-sm font-medium">Статья</span>
        <Button
          aria-label={expanded ? "Свернуть редактор" : "На весь экран"}
          onClick={expand}
          size="sm"
          type="button"
          variant="ghost"
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
          {expanded ? "Свернуть" : "На весь экран"}
        </Button>
      </div>
      <div
        aria-label="Форматирование"
        className="relative flex flex-wrap gap-1 border-b border-border bg-card p-2"
        role="toolbar"
      >
        <Button
          aria-label="Добавить блок"
          aria-expanded={menuOpen}
          disabled={disabled}
          onClick={() => {
            setMenuOpen(!menuOpen);
            setMenuSearch("");
          }}
          type="button"
          variant="ghost"
        >
          <Plus />
          Блок
        </Button>
        {menuOpen ? (
          <div
            className="absolute left-2 top-full z-20 w-72 rounded-xl border border-border bg-card p-2 shadow-xl"
            role="dialog"
            aria-label="Добавить блок"
          >
            <input
              autoFocus
              aria-label="Найти блок"
              className="mb-2 w-full rounded-lg bg-muted px-3 py-2 text-sm outline-none"
              onChange={(event) => {
                setMenuSearch(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setMenuOpen(false);
                  editor.commands.focus();
                }
              }}
              placeholder="Найти блок…"
              value={menuSearch}
            />
            {blocks
              .filter((block) =>
                block.name
                  .toLocaleLowerCase("ru")
                  .includes(menuSearch.toLocaleLowerCase("ru")),
              )
              .map((block) => (
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus:bg-muted"
                  key={block.name}
                  onClick={() => {
                    block.run();
                    setMenuOpen(false);
                  }}
                  type="button"
                >
                  <block.icon className="size-4" />
                  {block.name}
                </button>
              ))}
            <div className="flex items-center border-t border-border pt-2">
              <MaterialAssetUploadButtons
                controller={assetUploads}
                disabled={disabled || materialId === null}
              />
              <span className="text-xs text-muted-foreground">
                Фото или файл
              </span>
            </div>
          </div>
        ) : null}
        <ToolbarButton
          active={editor.isActive("bold")}
          disabled={disabled}
          label="Полужирный"
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("italic")}
          disabled={disabled}
          label="Курсив"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          label="Заголовок второго уровня"
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("bulletList")}
          disabled={disabled}
          label="Маркированный список"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List aria-hidden="true" />
        </ToolbarButton>
        <ToolbarButton
          active={editor.isActive("orderedList")}
          disabled={disabled}
          label="Нумерованный список"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered aria-hidden="true" />
        </ToolbarButton>
        <MaterialAssetUploadButtons
          controller={assetUploads}
          disabled={disabled || materialId === null}
        />
      </div>
      {linkOpen ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <input
            aria-label="Адрес ссылки"
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm"
            type="url"
            placeholder="https://…"
            value={linkUrl}
            onChange={(event) => {
              setLinkUrl(event.currentTarget.value);
            }}
          />
          <Button
            onClick={() => {
              let url: URL;
              try {
                url = new URL(linkUrl);
              } catch {
                setLinkInvalid(true);
                return;
              }
              if (!["https:", "http:"].includes(url.protocol)) {
                setLinkInvalid(true);
                return;
              }
              if (editor.state.selection.empty)
                editor
                  .chain()
                  .focus()
                  .insertContent({
                    type: "text",
                    text: url.href,
                    marks: [{ type: "link", attrs: { href: url.href } }],
                  })
                  .run();
              else editor.chain().focus().setLink({ href: url.href }).run();
              setLinkOpen(false);
            }}
            type="button"
          >
            Добавить
          </Button>
          <Button
            onClick={() => {
              setLinkOpen(false);
            }}
            type="button"
            variant="ghost"
          >
            Отмена
          </Button>
          {linkInvalid ? (
            <span role="alert" className="w-full text-xs text-destructive">
              Введите ссылку с http:// или https://.
            </span>
          ) : null}
        </div>
      ) : null}
      {editor.isActive("table") ? (
        <div className="flex flex-wrap gap-2 border-b border-border p-2">
          <Button
            onClick={() => {
              editor.chain().focus().addRowAfter().run();
            }}
            type="button"
            size="sm"
            variant="ghost"
          >
            Добавить строку
          </Button>
          <Button
            onClick={() => {
              editor.chain().focus().addColumnAfter().run();
            }}
            type="button"
            size="sm"
            variant="ghost"
          >
            Добавить столбец
          </Button>
          <Button
            onClick={() => {
              editor.chain().focus().deleteTable().run();
            }}
            type="button"
            size="sm"
            variant="ghost"
          >
            Убрать таблицу
          </Button>
        </div>
      ) : null}
      <MaterialAssetUploadQueue controller={assetUploads} />
      {materialId === null ? (
        <p className="border-b border-border bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          Сначала создайте черновик, затем добавляйте файлы и изображения.
        </p>
      ) : null}
      <EditorAssetContext.Provider
        value={{
          materialId,
          contentVersion,
          blocks: assetPreviewBlocks,
          localImages,
        }}
      >
        <EditorContent
          className="[&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:table-fixed [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-border [&_.ProseMirror_td]:p-2 [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-border [&_.ProseMirror_th]:bg-muted [&_.ProseMirror_th]:p-2 [&_.ProseMirror_aside]:rounded-xl [&_.ProseMirror_aside]:bg-muted [&_.ProseMirror_aside]:px-4 [&_.ProseMirror_aside]:py-2 [&_.ProseMirror]:mx-auto [&_.ProseMirror]:max-w-[52rem] [&_.ProseMirror]:min-h-[28rem] [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-accent [&_.ProseMirror_blockquote]:pl-5 [&_.ProseMirror_pre]:rounded-xl [&_.ProseMirror_pre]:bg-muted [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_hr]:my-8 [&_.ProseMirror_hr]:border-border [&_.ProseMirror_h3]:mt-6 [&_.ProseMirror_h3]:text-xl [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror]:px-5 [&_.ProseMirror]:py-6 [&_.ProseMirror]:text-[1rem] [&_.ProseMirror]:leading-[1.75] [&_.ProseMirror]:outline-none [&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-8 [&_.ProseMirror_h2]:text-2xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:tracking-[-0.025em] [&_.ProseMirror_li]:my-1 [&_.ProseMirror_ol]:ml-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_p]:my-4 [&_.ProseMirror_ul]:ml-6 [&_.ProseMirror_ul]:list-disc [&_.material-asset-node]:my-5 [&_.material-asset-node]:grid [&_.material-asset-node]:gap-1 [&_.material-asset-node]:rounded-xl [&_.material-asset-node]:border [&_.material-asset-node]:border-border [&_.material-asset-node]:bg-muted/50 [&_.material-asset-node]:p-4 [&_.material-asset-node__kind]:font-mono [&_.material-asset-node__kind]:text-xs [&_.material-asset-node__kind]:text-muted-foreground [&_.material-asset-node__label]:font-semibold sm:[&_.ProseMirror]:px-8 sm:[&_.ProseMirror]:py-8"
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
      </EditorAssetContext.Provider>
      <p className="px-6 pb-4 text-xs text-muted-foreground">
        «/» — добавить блок · Перетащите файлы или вставьте из буфера
      </p>
    </dialog>
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
    <Button
      aria-label={label}
      aria-pressed={active}
      className="size-11 sm:size-9"
      disabled={disabled}
      onClick={onClick}
      size="icon-lg"
      type="button"
      variant={active ? "secondary" : "ghost"}
    >
      {children}
    </Button>
  );
}
