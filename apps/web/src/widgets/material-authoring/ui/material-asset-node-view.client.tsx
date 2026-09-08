/* oxlint-disable next/no-img-element -- Uploaded blob previews are local and must not go through image optimization. */
"use client";

import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { createContext, useContext } from "react";
import { FileText, GripVertical, X } from "lucide-react";
import type { RenderedBlock } from "@/entities/material";
import {
  MaterialAssetImage,
  materialAssetFileHref,
} from "@/features/material-assets";

export const EditorAssetContext = createContext<{
  materialId: string | null;
  contentVersion: number | null;
  blocks: readonly RenderedBlock[];
  localImages: Readonly<Record<string, string>>;
}>({ materialId: null, contentVersion: null, blocks: [], localImages: {} });

function imageBlock(
  blocks: readonly RenderedBlock[],
  assetId: string,
): Extract<RenderedBlock, { kind: "image" }> | undefined {
  for (const block of blocks) {
    if (block.kind === "image" && block.assetId === assetId) return block;
    const nested =
      block.kind === "blockquote" || block.kind === "callout"
        ? block.content
        : block.kind === "bullet_list" || block.kind === "ordered_list"
          ? block.items.flat()
          : block.kind === "table"
            ? block.rows.flatMap((row) =>
                row.cells.flatMap((cell) => cell.content),
              )
            : [];
    const found = imageBlock(nested, assetId);
    if (found) return found;
  }
  return undefined;
}

export function MaterialAssetNodeView({
  node,
  updateAttributes,
  deleteNode,
  editor,
}: NodeViewProps) {
  const { materialId, contentVersion, blocks, localImages } =
    useContext(EditorAssetContext);
  const assetId = String(node.attrs.assetId ?? "");
  const isImage = node.type.name === "assetImage";
  const image = imageBlock(blocks, assetId);
  const localImage = localImages[assetId];
  const label = String(node.attrs.label ?? "Файл");
  const displayWidthPercent =
    typeof node.attrs.displayWidthPercent === "number"
      ? node.attrs.displayWidthPercent
      : 100;
  const alt = String(node.attrs.alt ?? "");
  return (
    <NodeViewWrapper
      className="group relative mx-auto my-6 rounded-xl bg-card"
      contentEditable={false}
    >
      <div className="absolute right-2 top-2 z-10 flex gap-1 rounded-lg bg-card/95 p-1 sm:opacity-0 focus-within:opacity-100 group-hover:opacity-100">
        <span
          aria-label="Перетащить блок"
          className="cursor-grab p-1"
          data-drag-handle
        >
          <GripVertical className="size-4" />
        </span>
        <button
          aria-label="Убрать вложение"
          className="rounded p-1 hover:bg-muted"
          disabled={!editor.isEditable}
          onClick={deleteNode}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      {isImage ? (
        <>
          <div
            className="mx-auto"
            style={{ width: `${String(displayWidthPercent)}%` }}
          >
            {localImage ? (
              <img
                alt={alt}
                className="max-h-[65vh] w-full rounded-t-xl object-contain"
                src={localImage}
              />
            ) : image && materialId && contentVersion ? (
              <MaterialAssetImage
                {...image}
                alt={alt}
                caption={undefined}
                displayWidthPercent={100}
                contentVersion={contentVersion}
                materialId={materialId}
                preview
              />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                Изображение сохранено. Предпросмотр временно недоступен.
              </p>
            )}
          </div>
          <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              Размер{" "}
              <input
                aria-label="Размер изображения"
                type="range"
                min={25}
                max={100}
                step={5}
                value={displayWidthPercent}
                disabled={!editor.isEditable}
                onChange={(event) => {
                  updateAttributes({
                    displayWidthPercent: Number(event.currentTarget.value),
                  });
                }}
                className="w-24 accent-primary"
              />
            </label>
            <output>{displayWidthPercent}%</output>
          </div>
          <input
            aria-label="Описание изображения"
            className="w-full border-0 bg-transparent px-4 py-2 text-sm text-muted-foreground outline-none"
            disabled={!editor.isEditable}
            onChange={(event) => {
              updateAttributes({ alt: event.currentTarget.value });
            }}
            placeholder="Описание изображения"
            value={alt}
          />
          <input
            aria-label="Подпись изображения"
            className="w-full border-0 border-t border-border bg-transparent px-4 py-2 text-sm outline-none"
            disabled={!editor.isEditable}
            onChange={(event) => {
              updateAttributes({ caption: event.currentTarget.value || null });
            }}
            placeholder="Подпись — необязательно"
            value={String(node.attrs.caption ?? "")}
          />
        </>
      ) : (
        <div className="flex items-center gap-3 p-4">
          <FileText
            aria-hidden="true"
            className="size-8 shrink-0 text-accent"
          />
          <input
            aria-label="Название вложения"
            className="min-w-0 flex-1 bg-transparent font-medium outline-none"
            disabled={!editor.isEditable}
            onChange={(event) => {
              updateAttributes({ label: event.currentTarget.value });
            }}
            value={label}
          />
          {materialId && contentVersion ? (
            <a
              className="text-sm underline"
              href={materialAssetFileHref({
                materialId,
                assetId,
                contentVersion,
                preview: true,
              })}
              target="_blank"
              rel="noreferrer"
            >
              Открыть
            </a>
          ) : null}
        </div>
      )}
    </NodeViewWrapper>
  );
}
