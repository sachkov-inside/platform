interface AuthenticationFeedbackProps {
  readonly authenticationError?: string | undefined;
}

export function AuthenticationFeedback({
  authenticationError,
}: AuthenticationFeedbackProps) {
  if (authenticationError === undefined) return null;

  const message =
    authenticationError === "logout-incomplete"
      ? "Локальная сессия завершена, но глобальный выход не подтверждён. Закройте браузер или завершите сессию у провайдера входа."
      : authenticationError === "retryable"
        ? "Провайдер подтвердил вход, но Platform временно не ответила. Нажмите «Войти» ещё раз: попытка продолжится без создания новой сессии."
        : authenticationError === "in-progress"
          ? "Вход уже начат в этой вкладке. Завершите открытый шаг у провайдера или дождитесь истечения попытки."
          : "Вход не завершён. Повторите попытку; если ошибка сохраняется, попробуйте позже.";

  return (
    <p
      className="mb-7 max-w-3xl border-y border-border py-3 text-sm leading-6 text-destructive"
      role="status"
    >
      {message}
    </p>
  );
}
