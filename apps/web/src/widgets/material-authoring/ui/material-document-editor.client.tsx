"use client";
import { useMaterialBlockControls } from "./use-material-block-controls";
import { materialSaveStateLabel } from "../model/material-save-state-label";
import { withMaterialNodeIds } from "../model/material-document-identifiers";

import { EditorContent, useEditor } from "@tiptap/react";
import {
  Bold,
  ExternalLink,
  Heading2,
  Heading3,
  Heading4,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Maximize2,
  Minimize2,
  Plus,
  Quote,
  Code2,
  Minus,
  Sparkles,
  Tags,
  Terminal,
  Type,
  Table2,
  Link2,
  Rows3,
  Columns3,
  Trash2,
  type LucideIcon,
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
import { MaterialBlockFields } from "./material-block-fields.client";
import { calloutTones, calloutTonePresentation } from "@/entities/material";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import styles from "./material-document-editor.module.css";

import type {
  MaterialAuthoringActions,
  MaterialAuthoringPresentation,
} from "../model/presentation";
import { materialEditorExtensions } from "../model/material-editor-extensions";
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
  saveState,
}: {
  readonly saveState?: MaterialAuthoringPresentation["save"];
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
  const [linkAsBlock, setLinkAsBlock] = useState(false);
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
  const [initialDocument] = useState(() =>
    withMaterialNodeIds({
      ...document,
      content:
        document.content?.at(-1)?.type === "paragraph"
          ? document.content
          : [...(document.content ?? []), { type: "paragraph" }],
    }),
  );
  const editor = useEditor({
    content: initialDocument,
    editable: !disabled,
    extensions: materialEditorExtensions,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      handleKeyDown(view, event) {
        if (
          (event.key === "/" || (event.key === "Tab" && !event.shiftKey)) &&
          view.state.selection.$from.parent.type.name === "paragraph" &&
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
        style: "outline: none",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChange(currentEditor.getJSON());
    },
  });
  const assetUploads = useMaterialAssetUploads(editor, materialId, imageReady);
  const {
    surface,
    anchor,
    selection,
    hover,
    insertionPosition,
    prepareTextBlock,
  } = useMaterialBlockControls(editor, menuOpen || linkOpen);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    searchInput.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          "[data-editor-block-menu], [data-editor-add-block]",
        )
      )
        return;
      setMenuOpen(false);
    };
    window.addEventListener("pointerdown", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
    };
  }, [menuOpen]);

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

  interface BlockOption {
    name: string;
    icon: LucideIcon;
    run: () => unknown;
    deferInsertion?: boolean;
  }
  // Текстовые блоки стоят до вложений, остальные после: порядок групп, а не индекс среза.
  const textBlocks: readonly BlockOption[] = [
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
      name: "Заголовок H4",
      icon: Heading4,
      run: () => editor.chain().focus().toggleHeading({ level: 4 }).run(),
    },
  ];
  const richBlocks: readonly BlockOption[] = [
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
    // Каждый вид врезки вставляется своим пунктом: иначе `tip` и остальные виды недостижимы.
    ...calloutTones.map((tone) => ({
      name: calloutTonePresentation(tone).label,
      icon: calloutTonePresentation(tone).icon,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "callout",
            attrs: { kind: tone },
            content: [{ type: "paragraph" }],
          })
          .run(),
    })),
    {
      name: "Ключевая мысль",
      icon: Sparkles,
      run: () => editor.chain().focus().insertContent({ type: "keyPoint" }).run(),
    },
    {
      name: "Итоги",
      icon: ListChecks,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "takeaways",
            attrs: { title: "Итоги урока" },
            content: [{ type: "paragraph" }],
          })
          .run(),
    },
    {
      name: "Промпт",
      icon: Terminal,
      run: () => editor.chain().focus().insertContent({ type: "agentPrompt" }).run(),
    },
    {
      name: "Ресурс",
      icon: ExternalLink,
      run: () => editor.chain().focus().insertContent({ type: "resourceCard" }).run(),
    },
    {
      name: "Термины",
      icon: Tags,
      run: () =>
        editor
          .chain()
          .focus()
          .insertContent({
            type: "labeledList",
            attrs: { rows: [{ label: "", name: "" }] },
          })
          .run(),
    },
    {
      name: "Ссылка",
      icon: Link2,
      deferInsertion: true,
      run: () => {
        setLinkAsBlock(true);
        setLinkOpen(true);
        setLinkUrl("");
        setLinkInvalid(false);
      },
    },
  ];
  const blockOptions = (options: readonly BlockOption[]) =>
    options
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
            if (!block.deferInsertion) prepareTextBlock();
            block.run();
            setMenuOpen(false);
          }}
          type="button"
        >
          <block.icon className="size-4" />
          {block.name}
        </button>
      ));

  return (
    <dialog
      open
      ref={dialog}
      aria-label="Редактор статьи"
      onKeyDownCapture={(event) => {
        if (event.key !== "Escape") return;
        if (!menuOpen && !linkOpen && !expanded) return;
        event.preventDefault();
        event.stopPropagation();
        if (menuOpen) {
          setMenuOpen(false);
          editor.commands.focus();
        } else if (linkOpen) {
          setLinkOpen(false);
          editor.commands.focus();
        } else expand();
      }}
      onCancel={(event) => {
        if (expanded) {
          event.preventDefault();
          expand();
        }
      }}
      className={
        expanded
          ? "fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto border-0 bg-card p-0 text-foreground backdrop:bg-black/40"
          : "relative m-0 mt-5 block w-full min-w-0 max-w-none overflow-visible rounded-2xl border border-border bg-card p-0 text-foreground"
      }
    >
      <div className="sticky top-0 z-30 flex min-h-12 flex-wrap items-center justify-end gap-1 rounded-t-2xl bg-card/95 px-3 py-1">
        <div className="mr-auto flex min-w-0 flex-wrap items-center gap-1">
          {editor.isActive("table") ? (
            <div
              className="flex gap-1"
              role="toolbar"
              aria-label="Таблица"
            >
              <Button
                aria-label="Добавить строку"
                title="Добавить строку"
                disabled={disabled}
                onClick={() => {
                  editor.chain().focus().addRowAfter().run();
                }}
                type="button"
                size="icon"
                variant="ghost"
              >
                <Rows3 />
              </Button>
              <Button
                aria-label="Добавить столбец"
                title="Добавить столбец"
                disabled={disabled}
                onClick={() => {
                  editor.chain().focus().addColumnAfter().run();
                }}
                type="button"
                size="icon"
                variant="ghost"
              >
                <Columns3 />
              </Button>
              <Button
                aria-label="Убрать таблицу"
                title="Убрать таблицу"
                disabled={disabled}
                onClick={() => {
                  editor.chain().focus().deleteTable().run();
                }}
                type="button"
                size="icon"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
          ) : null}
          <MaterialBlockFields disabled={disabled} editor={editor} />
        </div>
        <Button
          aria-label={expanded ? "Свернуть редактор" : "На весь экран"}
          title={expanded ? "Свернуть редактор" : "На весь экран"}
          onClick={expand}
          size="icon"
          type="button"
          variant="ghost"
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </div>
      <div
        ref={surface}
        className={`relative mx-auto flex w-full max-w-[46rem] flex-col px-10 sm:px-12 ${expanded ? "min-h-[calc(100dvh-3rem)]" : "min-h-[32rem]"}`}
      >
        <Button
          data-editor-add-block
          aria-label="Добавить блок"
          onPointerDown={(event) => {
            event.preventDefault();
          }}
          aria-expanded={menuOpen}
          disabled={disabled}
          style={{ top: anchor.top, left: anchor.left }}
          className="absolute z-20 size-8 rounded-full text-muted-foreground transition-none"
          onClick={() => {
            setMenuOpen(!menuOpen);
            setMenuSearch("");
          }}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus />
        </Button>
        <div
          data-editor-block-menu
          hidden={!menuOpen}
          style={{ top: anchor.top + 36, left: Math.min(anchor.left, 80) }}
          className="absolute z-40 max-h-80 w-64 max-w-[calc(100%-1rem)] overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-xl"
          role="dialog"
          aria-label="Добавить блок"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(false);
              editor.commands.focus();
            }
          }}
        >
          <input
            ref={searchInput}
            aria-label="Найти блок"
            className="mb-2 w-full rounded-lg bg-muted px-3 py-2 text-sm outline-none"
            onChange={(event) => {
              setMenuSearch(event.currentTarget.value);
            }}
            placeholder="Найти блок…"
            value={menuSearch}
          />
          {blockOptions(textBlocks)}
          <MaterialAssetUploadButtons
            controller={assetUploads}
            disabled={disabled || materialId === null}
            insertAt={insertionPosition}
            onSelected={() => {
              setMenuOpen(false);
            }}
            search={menuSearch}
          />
          {blockOptions(richBlocks)}
        </div>
        {selection && !menuOpen ? (
          <div
            aria-label="Форматирование"
            style={selection}
            className="absolute z-30 flex rounded-lg border border-border bg-card p-1 shadow-lg"
            role="toolbar"
          >
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
              active={editor.isActive("link")}
              disabled={disabled}
              label="Ссылка"
              onClick={() => {
                setLinkAsBlock(false);
                setLinkOpen(true);
                setLinkUrl(String(editor.getAttributes("link").href ?? ""));
                setLinkInvalid(false);
              }}
            >
              <Link2 aria-hidden="true" />
            </ToolbarButton>
          </div>
        ) : null}
        {linkOpen ? (
          <div className="absolute inset-x-4 top-0 z-40 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-lg">
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
                if (linkAsBlock) prepareTextBlock();
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
            onPointerMove={(event) => {
              hover(event.target);
            }}
            className={cn(
              styles.content,
              "[&_.ProseMirror>*+*]:mt-6 [&_.ProseMirror>p]:min-h-7 [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:table-fixed [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-border [&_.ProseMirror_td]:p-2 [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-border [&_.ProseMirror_th]:bg-muted [&_.ProseMirror_th]:p-2 [&_.ProseMirror]:mx-auto [&_.ProseMirror]:min-h-[28rem] [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-accent [&_.ProseMirror_blockquote]:pl-5 [&_.ProseMirror_pre]:rounded-xl [&_.ProseMirror_pre]:bg-muted [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_hr]:my-8 [&_.ProseMirror_hr]:border-border [&_.ProseMirror_h3]:mt-6 [&_.ProseMirror_h3]:text-xl [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror]:py-2 [&_.ProseMirror]:text-[1rem] [&_.ProseMirror]:leading-[1.75] [&_.ProseMirror]:outline-none [&_.ProseMirror_h2]:mb-3 [&_.ProseMirror_h2]:mt-8 [&_.ProseMirror_h2]:text-2xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:tracking-[-0.025em] [&_.ProseMirror_li]:my-1 [&_.ProseMirror_ol]:ml-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_p]:my-4 [&_.ProseMirror_ul]:ml-6 [&_.ProseMirror_ul]:list-disc [&_.material-asset-node]:my-5 [&_.material-asset-node]:grid [&_.material-asset-node]:gap-1 [&_.material-asset-node]:rounded-xl [&_.material-asset-node]:border [&_.material-asset-node]:border-border [&_.material-asset-node]:bg-muted/50 [&_.material-asset-node]:p-4 [&_.material-asset-node__kind]:font-mono [&_.material-asset-node__kind]:text-xs [&_.material-asset-node__kind]:text-muted-foreground [&_.material-asset-node__label]:font-semibold [&_.ProseMirror_p:empty]:min-h-7 [&_.ProseMirror_p:empty]:before:pointer-events-none [&_.ProseMirror_p:empty]:before:float-left [&_.ProseMirror_p:empty]:before:text-muted-foreground/60 [&_.ProseMirror_p:empty]:before:content-['Напишите_текст…']",
            )}
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
        <div className="sticky bottom-0 mt-auto flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 bg-card/95 py-3 text-xs text-muted-foreground">
          {saveState ? (
            <span role="status">{materialSaveStateLabel(saveState)}</span>
          ) : null}
          <span className="ml-auto text-right">
            Tab — добавить блок
            <span className="hidden sm:inline">
              {" "}
              · Shift+Enter — выйти из блока
            </span>
          </span>
        </div>
      </div>
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
      onMouseDown={(event) => {
        event.preventDefault();
      }}
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
