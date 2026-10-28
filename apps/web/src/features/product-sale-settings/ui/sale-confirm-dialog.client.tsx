"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

import { hasText } from "@/shared/lib/text";
import { Button } from "@/shared/ui/button";

/**
 * Подтверждение денежного действия без причины: команда цены причину не принимает. Диалог
 * называет последствие, кнопка называет итог. Фокус начинается на «Отмена», а пока действие
 * выполняется, Escape диалог не закрывает. Ошибка последней попытки остаётся внутри диалога.
 */
export function SaleConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  tone = "default",
  pending = false,
  error = null,
  onConfirm,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly consequence: ReactNode;
  readonly confirmLabel: string;
  readonly tone?: "default" | "danger";
  readonly pending?: boolean;
  readonly error?: string | null;
  readonly onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const id = useId();

  // Модальный слой принадлежит элементу: `showModal` и `close` синхронизируются с `open`.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    if (open) cancel.current?.focus();
  }, [open]);

  return (
    <dialog
      aria-describedby={`${id}-consequence`}
      aria-labelledby={`${id}-heading`}
      className="admin-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onOpenChange(false);
      }}
      onClose={(event) => {
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
          <div>
            <h2 id={`${id}-heading`}>{title}</h2>
            <div className="admin-dialog-consequence" id={`${id}-consequence`}>
              {consequence}
            </div>
          </div>
          {hasText(error) ? (
            <div className="admin-dialog-banner" role="alert">
              <CircleAlert aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="admin-dialog-footer">
            <Button
              className="min-h-11 px-4"
              disabled={pending}
              onClick={() => {
                onOpenChange(false);
              }}
              ref={cancel}
              type="button"
              variant="outline"
            >
              Отмена
            </Button>
            <Button
              aria-busy={pending}
              className="min-h-11 px-4"
              disabled={pending}
              onClick={onConfirm}
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
        </div>
      ) : null}
    </dialog>
  );
}
