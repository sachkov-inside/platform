"use client";

import { CircleAlert } from "lucide-react";
import { type ReactNode } from "react";

// Классы окна и полей (`admin-dialog`, `admin-field`) принадлежат общим модулям админки.
import { useNativeDialog } from "@/shared/lib/native-dialog.client";

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
  const dialog = useNativeDialog({ open, pending: pending, onOpenChange });

  return (
    <dialog aria-labelledby={labelledBy} className="admin-dialog" {...dialog}>
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
