"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useId, useRef } from "react";

import { Button } from "@/shared/ui/button";

import type { MaterialLifecycleActionState } from "../model/material-lifecycle-state";

export function MaterialDeleteDialog({
  contentVersion,
  materialId,
  onDelete,
  pending,
  state,
  submissionId,
  title,
}: {
  readonly contentVersion: number;
  readonly materialId: string;
  readonly onDelete: (formData: FormData) => void;
  readonly pending: boolean;
  readonly state: MaterialLifecycleActionState;
  readonly submissionId: string;
  readonly title: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
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
      <Button
        className="min-h-11"
        onClick={() => {
          dialog.current?.showModal();
        }}
        type="button"
        variant="destructive"
      >
        <Trash2 aria-hidden="true" data-icon="inline-start" />
        Удалить черновик
      </Button>
      <dialog
        aria-describedby={descriptionId}
        aria-labelledby={headingId}
        className="m-auto w-[min(34rem,calc(100%-2rem))] rounded-2xl border border-border bg-card p-0 text-foreground shadow-card backdrop:bg-foreground/45"
        onCancel={() => {
          dialog.current?.close();
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
            Черновик никогда не публиковался. Он будет удалён безвозвратно вместе
            с текущим содержимым.
          </p>
          {title === null ? (
            <p className="mt-3 truncate font-mono text-xs text-muted-foreground">
              {materialId}
            </p>
          ) : null}
          <DeletionNotice state={state} />
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
                const formData = new FormData();
                formData.set(
                  "expectedContentVersion",
                  String(contentVersion),
                );
                formData.set("materialId", materialId);
                formData.set("operation", "delete");
                formData.set("submissionId", submissionId);
                onDelete(formData);
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

function DeletionNotice({ state }: { readonly state: MaterialLifecycleActionState }) {
  if (state.kind === "idle" || state.kind === "deleted" || state.kind === "saved") {
    return null;
  }
  const message =
    state.kind === "unauthorized"
      ? "Сессия завершилась. Войдите снова, чтобы удалить черновик."
      : state.kind === "forbidden"
        ? "У текущего аккаунта больше нет права управлять материалами."
        : state.kind === "not_found"
          ? "Материал уже удалён или больше недоступен. Обновите список."
          : state.kind === "conflict"
            ? state.reason === "draft_deletion_forbidden"
              ? "Материал уже публиковался и больше не может быть удалён как безопасный черновик."
              : "Материал изменился в другой сессии. Обновите страницу перед удалением."
            : state.kind === "invalid_input"
              ? "Не удалось проверить запрос на удаление. Обновите страницу."
              : state.kind === "infrastructure_error"
                ? `Удаление временно недоступно. Повторите с тем же запросом. Код: ${state.reference}`
                : `Не удалось проверить результат удаления. Код: ${state.reference}`;
  return (
    <div
      className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
      role="alert"
    >
      <p>{message}</p>
      {state.kind === "conflict" || state.kind === "not_found" ? (
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
