"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/shared/ui/button";

import type {
  DeleteMaterialDraftInput,
  DeleteMaterialDraftResult,
} from "../model/delete-material-draft";

interface DeletableVideo {
  readonly origin: "external_attachment" | "platform_upload";
  readonly title: string;
  readonly videoId: string;
}

/**
 * Confirmation of a draft hard-delete. By default its own «Удалить черновик» button opens it. With
 * `open` the caller opens it from elsewhere (a row menu of the Materials list) and learns about every
 * close (Escape, «Оставить черновик») through `onOpenChange`; the dialog then renders no button.
 */
export function MaterialDeleteDialog({
  contentVersion,
  materialId,
  onDelete,
  onOpenChange,
  open,
  pending,
  primaryVideo = null,
  result,
  submissionId,
  title,
}: {
  readonly contentVersion: number;
  readonly materialId: string;
  readonly onDelete: (input: DeleteMaterialDraftInput) => void;
  readonly onOpenChange?: (open: boolean) => void;
  readonly open?: boolean;
  readonly pending: boolean;
  readonly primaryVideo?: DeletableVideo | null;
  readonly result: DeleteMaterialDraftResult | null;
  readonly submissionId: string;
  readonly title: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // A modal `<dialog>` opens only through `showModal()`: the effect keeps the element in step with
  // the caller's `open`.
  useEffect(() => {
    const element = dialog.current;
    if (open === undefined || element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const [deleteOwnedVideo, setDeleteOwnedVideo] = useState(false);
  const dialogId = useId();
  const trimmedTitle = title?.trim();
  const displayTitle =
    trimmedTitle === undefined || trimmedTitle.length === 0
      ? "Черновик без названия"
      : trimmedTitle;
  const headingId = `${dialogId}-delete-heading`;
  const descriptionId = `${dialogId}-delete-description`;

  return (
    <>
      {open === undefined ? (
        <Button
          className="min-h-11"
          onClick={() => {
            setDeleteOwnedVideo(false);
            dialog.current?.showModal();
          }}
          type="button"
          variant="destructive"
        >
          <Trash2 aria-hidden="true" data-icon="inline-start" />
          Удалить черновик
        </Button>
      ) : null}
      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={headingId}
        className="m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-card backdrop:bg-foreground/45"
        onCancel={() => {
          dialog.current?.close();
        }}
        onClose={() => {
          onOpenChange?.(false);
        }}
        ref={dialog}
      >
        <div className="p-6 sm:p-8">
          <h2
            className="text-balance text-2xl font-semibold tracking-[-0.03em]"
            id={headingId}
          >
            Удалить «{displayTitle}»?
          </h2>
          <p
            className="mt-3 text-sm leading-6 text-muted-foreground"
            id={descriptionId}
          >
            Черновик никогда не публиковался. Он будет удалён безвозвратно
            вместе с текущим содержимым.
          </p>
          {title === null ? (
            <p className="mt-3 truncate font-mono text-xs text-muted-foreground">
              {materialId}
            </p>
          ) : null}
          {primaryVideo?.origin === "platform_upload" ? (
            <label className="mt-5 flex items-start gap-3 rounded-xl border border-destructive/30 p-4 text-sm leading-6">
              <input
                checked={deleteOwnedVideo}
                className="mt-1 size-4"
                disabled={pending}
                onChange={(event) => {
                  setDeleteOwnedVideo(event.currentTarget.checked);
                }}
                type="checkbox"
              />
              <span>
                Также удалить «{primaryVideo.title}» из Kinescope.
                Восстановление не гарантируется.
              </span>
            </label>
          ) : primaryVideo?.origin === "external_attachment" ? (
            <p className="mt-5 rounded-xl border border-border p-4 text-sm leading-6 text-muted-foreground">
              «{primaryVideo.title}» останется в Kinescope: Platform не удаляет
              привязанные извне видео.
            </p>
          ) : null}
          <DeletionNotice result={result} />
          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button
              className="min-h-11 px-4"
              disabled={pending}
              onClick={() => {
                dialog.current?.close();
              }}
              type="button"
              variant="outline"
            >
              Оставить черновик
            </Button>
            <Button
              className="min-h-11 px-4"
              disabled={pending}
              onClick={() => {
                onDelete({
                  deleteVideoId: deleteOwnedVideo
                    ? (primaryVideo?.videoId ?? null)
                    : null,
                  expectedContentVersion: contentVersion,
                  materialId,
                  submissionId,
                });
              }}
              type="button"
              variant="destructive"
            >
              {pending ? "Удаляем…" : "Удалить безвозвратно"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

function DeletionNotice({
  result,
}: {
  readonly result: DeleteMaterialDraftResult | null;
}) {
  if (result === null || result.kind === "deleted") return null;
  const message =
    result.kind === "unauthorized"
      ? "Сессия завершилась. Войдите снова, чтобы удалить черновик."
      : result.kind === "forbidden"
        ? "У текущего аккаунта больше нет права управлять материалами."
        : result.kind === "not_found"
          ? "Материал уже удалён или больше недоступен. Обновите список."
          : result.kind === "conflict"
            ? result.reason === "draft_deletion_forbidden"
              ? "Материал уже публиковался и больше не может быть удалён как безопасный черновик."
              : "Материал изменился в другой сессии. Обновите страницу перед удалением."
            : result.kind === "invalid_input"
              ? "Не удалось проверить запрос на удаление. Обновите страницу."
              : result.kind === "infrastructure_error"
                ? `Удаление временно недоступно. Повторите с тем же запросом. Код: ${result.reference}`
                : `Не удалось проверить результат удаления. Код: ${result.reference}`;
  return (
    <div
      className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
      role="alert"
    >
      <p>{message}</p>
      {result.kind === "conflict" || result.kind === "not_found" ? (
        <button
          className="mt-2 inline-flex items-center gap-2 font-semibold underline underline-offset-4"
          onClick={() => {
            window.location.reload();
          }}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Загрузить актуальное состояние
        </button>
      ) : null}
    </div>
  );
}
