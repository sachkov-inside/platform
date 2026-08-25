export function LibraryPage() {
  return (
    <>
      <header className="max-w-3xl">
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
          Библиотека
        </h1>
        <p className="mt-4 max-w-[66ch] text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          Полный каталог материалов с поиском по тексту и фильтрами по реальному содержанию.
        </p>
      </header>
      <section
        aria-labelledby="library-empty-heading"
        className="mt-12 max-w-3xl border-y border-border py-6 sm:py-8"
      >
        <h2
          className="text-xl font-semibold tracking-[-0.025em]"
          id="library-empty-heading"
        >
          Поиск появится вместе с материалами
        </h2>
        <p className="mt-3 max-w-[65ch] text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          Здесь нет демонстрационных публикаций: результаты, темы, форматы и серии подключатся к
          канонической коллекции, когда она будет готова.
        </p>
        <p className="mt-6 flex items-center gap-3 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
          Статус раздела: ожидает каталог
        </p>
      </section>
    </>
  );
}
