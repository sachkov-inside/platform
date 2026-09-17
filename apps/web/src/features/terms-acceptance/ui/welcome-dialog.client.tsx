"use client";

import { useEffect, useRef, type ReactNode } from "react";

import "./welcome-dialog.css";

/**
 * Модальное окно первого входа. Сервер отдаёт его уже открытым, чтобы строка о принятии и ссылки
 * были видны до загрузки скриптов; после загрузки окно становится модальным и остальная страница
 * неактивна. Решение обязательно: без `dismissible` окно не закрывается ни Esc, ни жестом «назад».
 */
export function WelcomeDialog({
  labelledBy,
  dismissible = false,
  children,
}: {
  readonly labelledBy: string;
  readonly dismissible?: boolean;
  readonly children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element === null || element.matches(":modal")) return;
    if (element.open) element.close();
    element.showModal();
    // React focuses `autoFocus` before the dialog opens; the decision button must own focus after it.
    element.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      open
      aria-labelledby={labelledBy}
      // `closedby` ещё не поддерживает Safari; там закрытие по Esc отменяет `onCancel`.
      {...{ closedby: dismissible ? "closerequest" : "none" }}
      onCancel={(event) => {
        if (!dismissible) event.preventDefault();
      }}
      className="welcome-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] max-w-none overflow-y-auto overscroll-contain rounded-[1.25rem] border border-border bg-card p-0 text-foreground shadow-card"
    >
      {children}
    </dialog>
  );
}
