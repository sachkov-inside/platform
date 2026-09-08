"use client";

import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";

import { ContentCoverImage, type ContentCover } from "@/entities/material";
import type { ContentCoverOwnerKind } from "@/shared/content-cover-owner";
import { usePendingUploadGuard } from "@/shared/lib/autosave/use-autosave";
import { Button, buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import {
  removeContentCover,
  uploadContentCover,
} from "../api/change-content-cover.browser";

export function ContentCoverEditor({
  disabled = false,
  initialCover,
  onChange,
  ownerId,
  ownerKind,
  ownerLabel,
}: {
  readonly disabled?: boolean;
  readonly initialCover: ContentCover | null;
  readonly onChange?: (cover: ContentCover | null) => void;
  readonly ownerId: string;
  readonly ownerKind: ContentCoverOwnerKind;
  readonly ownerLabel?: string;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState(false);
  const [cover, setCover] = useState(initialCover);
  const change = useMutation({
    mutationFn: (file: File) =>
      uploadContentCover({ currentCover: cover, file, ownerId, ownerKind }),
    onSuccess: applyResult,
  });
  const remove = useMutation({
    mutationFn: () => {
      if (cover === null) throw new TypeError("Expected a current cover");
      return removeContentCover({ currentCover: cover, ownerId, ownerKind });
    },
    onSuccess: applyResult,
  });
  const pending = change.isPending || remove.isPending;
  usePendingUploadGuard(pending);
  const result = change.data ?? remove.data;

  function applyResult(next: Awaited<ReturnType<typeof uploadContentCover>>) {
    if (next.kind !== "saved") return;
    setCover(next.cover);
    onChange?.(next.cover);
  }

  function acceptFile(file: File | undefined) {
    if (!file || disabled || pending) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setFileError(true);
      return;
    }
    setFileError(false);
    change.reset();
    remove.reset();
    change.mutate(file);
  }

  return (
    <section
      aria-label={`Обложка: ${ownerLabel ?? ownerId}`}
      aria-busy={pending}
      className={cn(
        "rounded-xl border border-dashed bg-background p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dragging ? "border-accent bg-accent/10" : "border-border",
      )}
      tabIndex={0}
      onDragOver={(event) => {
        if (disabled || pending || !event.dataTransfer.types.includes("Files"))
          return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(event) => {
        if (disabled || pending) return;
        event.preventDefault();
        event.stopPropagation();
        setDragging(false);
        acceptFile(event.dataTransfer.files[0]);
      }}
      onPaste={(event) => {
        if (event.clipboardData.files.length === 0 || disabled || pending)
          return;
        event.preventDefault();
        event.stopPropagation();
        acceptFile(event.clipboardData.files[0]);
      }}
    >
      <h3 className="text-sm font-semibold" id={`${inputId}-heading`}>
        Обложка
      </h3>
      <div className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-3">
        <ContentCoverImage
          alt=""
          className="aspect-video rounded-lg"
          cover={cover}
          sizes="6rem"
        />
        <div className="min-w-0">
          <p className="text-xs leading-5 text-muted-foreground">
            Перетащите изображение или вставьте из буфера.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <label
              aria-disabled={disabled || pending}
              className={cn(
                buttonVariants({ size: "sm", variant: "outline" }),
                (disabled || pending) && "pointer-events-none opacity-50",
              )}
              htmlFor={inputId}
            >
              {pending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <ImagePlus aria-hidden="true" />
              )}
              {pending
                ? "Обрабатываем…"
                : cover === null
                  ? "Загрузить"
                  : "Заменить"}
            </label>
            {cover === null ? null : (
              <Button
                disabled={disabled || pending}
                onClick={() => {
                  remove.mutate();
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" />
                Удалить
              </Button>
            )}
          </div>
          <input
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={disabled || pending}
            id={inputId}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              acceptFile(file);
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </div>
      </div>
      {fileError ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          Выберите JPEG, PNG или WebP.
        </p>
      ) : null}
      {result?.kind === "saved" ? (
        <p className="mt-2 text-xs font-semibold" role="status">
          Обложка обновлена.
        </p>
      ) : null}
      {result?.kind === "conflict" ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          Обложка уже изменилась. Обновите страницу.
        </p>
      ) : null}
      {result?.kind === "error" || change.isError || remove.isError ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          Не удалось обновить обложку.
        </p>
      ) : null}
    </section>
  );
}
