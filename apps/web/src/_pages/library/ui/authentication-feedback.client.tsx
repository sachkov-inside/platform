"use client";

import { X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

export function AuthenticationFeedback() {
  const searchParams = useSearchParams();
  const [authenticationError] = useState(() => {
    const values = searchParams.getAll("authentication");
    return values.length === 1 ? values[0] : undefined;
  });
  const [isVisible, setIsVisible] = useState(true);
  if (authenticationError === undefined || !isVisible) return null;

  const message =
    authenticationError === "logout-incomplete"
      ? "Локальная сессия завершена, но глобальный выход не подтверждён. Закройте браузер или завершите сессию у провайдера входа."
      : authenticationError === "retryable"
        ? "Провайдер подтвердил вход, но Platform временно не ответила. Нажмите «Войти» ещё раз: попытка продолжится без создания новой сессии."
        : authenticationError === "in-progress"
          ? "Вход уже начат в этой вкладке. Завершите открытый шаг у провайдера или дождитесь истечения попытки."
          : "Вход не завершён. Повторите попытку; если ошибка сохраняется, попробуйте позже.";

  return (
    <div
      className="fixed right-5 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 flex w-[calc(100%-2.5rem)] max-w-md items-start gap-3 rounded-2xl border border-destructive/25 bg-background px-5 py-4 text-sm leading-6 text-destructive shadow-lg md:bottom-5"
      role="status"
    >
      <p className="min-w-0 flex-1">{message}</p>
      <button
        aria-label="Закрыть уведомление"
        className="-m-2 shrink-0 rounded-full p-2 text-current transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        onClick={() => setIsVisible(false)}
        type="button"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
