interface HomePageProps {
  readonly authenticationError?: string | undefined;
}

export function HomePage({ authenticationError }: HomePageProps) {
  const authenticationMessage =
    authenticationError === "logout-incomplete"
      ? "Локальная сессия завершена, но глобальный выход не подтверждён. Закройте браузер или завершите сессию у провайдера входа."
      : authenticationError === "retryable"
        ? "Провайдер подтвердил вход, но Platform временно не ответила. Нажмите «Войти» ещё раз: попытка продолжится без создания новой сессии."
        : authenticationError === "in-progress"
          ? "Вход уже начат в этой вкладке. Завершите открытый шаг у провайдера или дождитесь истечения попытки."
          : "Вход не завершён. Повторите попытку; если ошибка сохраняется, попробуйте позже.";

  return (
    <>
      <header className="max-w-3xl">
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
          Главная
        </h1>
        <p className="mt-4 max-w-[66ch] text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          Точка входа в материалы Inside: новые публикации, темы и активные плейлисты.
        </p>
      </header>
      {authenticationError === undefined ? null : (
        <p
          className="mt-7 max-w-3xl border-y border-border py-3 text-sm leading-6 text-destructive"
          role="status"
        >
          {authenticationMessage}
        </p>
      )}
      <section
        aria-labelledby="home-empty-heading"
        className="mt-12 max-w-3xl border-y border-border py-6 sm:py-8"
      >
        <h2
          className="text-xl font-semibold tracking-[-0.025em]"
          id="home-empty-heading"
        >
          Коллекция собирается
        </h2>
        <p className="mt-3 max-w-[65ch] text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          Здесь появятся опубликованные материалы и быстрые пути к продолжению чтения. Пока
          страница честно показывает только готовую основу приложения.
        </p>
        <p className="mt-6 flex items-center gap-3 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
          Статус раздела: ожидает опубликованные материалы
        </p>
      </section>
    </>
  );
}
