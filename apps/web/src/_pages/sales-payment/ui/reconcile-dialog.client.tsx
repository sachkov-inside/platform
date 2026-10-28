"use client";

import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { hasText } from "@/shared/lib/text";
import { Button } from "@/shared/ui/button";

import "@/shared/ui/admin/admin.css";

/**
 * Подтверждение «Сверить с банком». Сверка не списывает и не возвращает деньги, но обращается к
 * банку, поэтому идёт после явного подтверждения. Пока она выполняется, диалог не закрывается.
 */
export function ReconcileDialog({
  open,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  readonly open: boolean;
  readonly pending: boolean;
  /** Ошибка последней попытки: диалог остаётся открытым и показывает её. */
  readonly error: string | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const id = useId();

  // Модальный слой принадлежит элементу: `showModal` и `close` идут вместе с `open`.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    if (open) confirm.current?.focus();
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
        <form
          className="admin-dialog-body"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending) onConfirm();
          }}
        >
          <div>
            <h2 id={`${id}-heading`}>Сверить платёж с банком?</h2>
            <div className="admin-dialog-consequence" id={`${id}-consequence`}>
              Платформа спросит у банка текущее состояние оплаты и обновит
              платёж. Деньги не списываются и не возвращаются, повторная сверка
              безопасна.
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
              type="button"
              variant="outline"
            >
              Отмена
            </Button>
            <Button
              aria-busy={pending}
              className="min-h-11 px-4"
              disabled={pending}
              ref={confirm}
              type="submit"
            >
              {pending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : null}
              Сверить с банком
            </Button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
