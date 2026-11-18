"use client";

import type { ReactNode } from "react";

import { mountWelcomeDialog } from "./welcome-dialog.browser";

import "./welcome-dialog.css";

/**
 * Модальное окно первого входа. Сервер отдаёт его уже открытым, чтобы строка о принятии и ссылки
 * были видны до загрузки скриптов; после загрузки окно становится модальным и остальная страница
 * неактивна. Окно не закрывается ни Esc, ни жестом «назад»: выход — только его собственные действия.
 */
export function WelcomeDialog({
  labelledBy,
  children,
}: {
  readonly labelledBy: string;
  readonly children: ReactNode;
}) {
  return (
    <dialog
      ref={mountWelcomeDialog}
      open
      aria-labelledby={labelledBy}
      // Без поддержки closedby закрытие по Esc всё равно предотвращает native cancel handler.
      {...{ closedby: "none" }}
      className="welcome-dialog m-auto max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] max-w-none overflow-y-auto overscroll-contain rounded-[1.25rem] border border-border bg-card p-0 text-foreground shadow-card"
    >
      {children}
    </dialog>
  );
}
