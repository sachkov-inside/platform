"use client";

import { CircleAlert, LoaderCircle, X } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

import { hasText } from "@/shared/lib/text";
import { Button } from "@/shared/ui/button";

import "./admin.css";

export interface AdminDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** Короткое пояснение под заголовком. */
  readonly description?: ReactNode;
  /** Пока действие выполняется, Escape и «Закрыть» диалог не закрывают. */
  readonly pending?: boolean;
  readonly children: ReactNode;
}

/**
 * Модальная форма админки: на телефоне лист снизу, с ширины 48rem диалог по центру. Держит
 * модальный слой браузера в согласии с `open` и возвращает фокус туда, откуда диалог открыли.
 * Содержимое монтируется только в открытом диалоге, поэтому каждое открытие начинается заново.
 */
export function AdminDialog({
  open,
  onOpenChange,
  title,
  description,
  pending = false,
  children,
}: AdminDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const headingId = `${id}-heading`;
  const descriptionId = `${id}-description`;

  // `showModal` и `close` принадлежат элементу: эффект разметки ставит модальный слой раньше,
  // чем формы внутри ставят свой первый фокус.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      aria-describedby={description === undefined ? undefined : descriptionId}
      aria-labelledby={headingId}
      className="admin-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onOpenChange(false);
      }}
      onClose={(event) => {
        // Событие close приходит задачей позже: к этому времени диалог могли открыть снова.
        if (open && !event.currentTarget.open) onOpenChange(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        if (!pending) onOpenChange(false);
      }}
      ref={dialog}
    >
      {open ? (
        <div className="admin-dialog-body">
          <div className="admin-dialog-heading">
            <div>
              <h2 id={headingId}>{title}</h2>
              {description === undefined ? null : (
                <div className="admin-dialog-consequence" id={descriptionId}>
                  {description}
                </div>
              )}
            </div>
            <button
              aria-label="Закрыть"
              className="admin-dialog-close"
              disabled={pending}
              onClick={() => {
                onOpenChange(false);
              }}
              type="button"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

export interface AdminConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** Что изменится после подтверждения. */
  readonly consequence: ReactNode;
  /** Кнопка называет итог: «Отозвать ссылку». */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly tone?: "default" | "danger";
  readonly pending?: boolean;
  /** Ошибка последней попытки: диалог остаётся открытым и показывает её. */
  readonly error?: string | null;
  /** Своё действие рядом с ошибкой, например «Обновить данные». */
  readonly errorAction?: ReactNode;
  readonly onConfirm: () => void;
}

/**
 * Подтверждение редкого действия без причины. У опасного действия первый фокус на безопасной
 * кнопке отмены.
 */
export function AdminConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Отмена",
  tone = "default",
  pending = false,
  error = null,
  errorAction,
  onConfirm,
}: AdminConfirmDialogProps) {
  return (
    <AdminDialog
      description={consequence}
      onOpenChange={onOpenChange}
      open={open}
      pending={pending}
      title={title}
    >
      <ConfirmBody
        cancelLabel={cancelLabel}
        confirmLabel={confirmLabel}
        error={error}
        errorAction={errorAction}
        onCancel={() => {
          onOpenChange(false);
        }}
        onConfirm={onConfirm}
        pending={pending}
        tone={tone}
      />
    </AdminDialog>
  );
}

function ConfirmBody({
  cancelLabel,
  confirmLabel,
  error,
  errorAction,
  onCancel,
  onConfirm,
  pending,
  tone,
}: {
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly error: string | null;
  readonly errorAction: ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly pending: boolean;
  readonly tone: "default" | "danger";
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (tone === "danger") cancel.current?.focus();
    else confirm.current?.focus();
  }, [tone]);
  return (
    <>
      {hasText(error) ? (
        <AdminDialogError action={errorAction}>{error}</AdminDialogError>
      ) : null}
      <div className="admin-dialog-footer">
        <Button
          className="min-h-11 px-4"
          disabled={pending}
          onClick={onCancel}
          ref={cancel}
          type="button"
          variant="outline"
        >
          {cancelLabel}
        </Button>
        <Button
          aria-busy={pending}
          className="min-h-11 px-4"
          disabled={pending}
          onClick={onConfirm}
          ref={confirm}
          type="button"
          variant={tone === "danger" ? "destructive" : "default"}
        >
          {pending ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {confirmLabel}
        </Button>
      </div>
    </>
  );
}

/** Ошибка внутри диалога: причина и, если есть, следующее действие. */
export function AdminDialogError({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="admin-dialog-banner" role="alert">
      <CircleAlert aria-hidden="true" />
      <div className="grid gap-2">
        <span>{children}</span>
        {action === undefined || action === null ? null : <div>{action}</div>}
      </div>
    </div>
  );
}
