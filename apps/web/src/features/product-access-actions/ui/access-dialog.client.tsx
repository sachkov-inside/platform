"use client";

import { CircleAlert } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

// Классы окна и полей (`admin-dialog`, `admin-field`) принадлежат общим модулям админки.
import "@/shared/ui/admin";

/**
 * Модальное окно действия с доступом в том же виде, что `ReasonDialog`: на телефоне лист снизу,
 * Escape закрывает окно, но не посреди выполнения. Содержимое рендерится, только пока окно
 * открыто, поэтому каждое открытие начинает форму заново.
 */
export function AccessDialog({
  children,
  labelledBy,
  onOpenChange,
  open,
  pending,
}: {
  readonly children: ReactNode;
  readonly labelledBy: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly pending: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  // Синхронизация с модальным слоем браузера: `showModal` и `close` принадлежат элементу.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      aria-labelledby={labelledBy}
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
      {open ? children : null}
    </dialog>
  );
}

/** Ошибка последней попытки внутри окна: окно остаётся открытым и говорит, что делать. */
export function AccessDialogError({
  message,
}: {
  readonly message: string | null;
}) {
  if (message === null) return null;
  return (
    <div className="admin-dialog-banner" role="alert">
      <CircleAlert aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function AccessFieldError({
  children,
  id,
}: {
  readonly children: ReactNode;
  readonly id: string;
}) {
  return (
    <p className="admin-field-error" id={id}>
      <CircleAlert aria-hidden="true" />
      {children}
    </p>
  );
}
