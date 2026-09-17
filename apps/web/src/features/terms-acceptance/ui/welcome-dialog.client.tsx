"use client";

import { useEffect, useRef, type ReactNode } from "react";

import "./welcome-dialog.css";

/**
 * Модальное окно первого входа. Решение обязательно: окно не закрывается ни Esc, ни жестом
 * «назад», ни щелчком по фону. Нативный `showModal()` делает остальную страницу неактивной.
 */
export function WelcomeDialog({
  labelledBy,
  children,
}: {
  readonly labelledBy: string;
  readonly children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element === null || element.open) return;
    element.showModal();
    // React focuses `autoFocus` before the dialog opens; the decision button must own focus after it.
    element.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={labelledBy}
      // `closedby` ещё не поддерживает Safari; там закрытие по Esc отменяет `onCancel`.
      {...{ closedby: "none" }}
      onCancel={(event) => {
        event.preventDefault();
      }}
      className="welcome-dialog m-auto w-[min(26rem,calc(100vw-2rem))] max-w-none overflow-visible rounded-[1.25rem] border border-border bg-card p-0 text-foreground shadow-card"
    >
      {children}
    </dialog>
  );
}
