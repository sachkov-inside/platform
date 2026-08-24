export function MapPage() {
  return (
    <>
      <header className="max-w-3xl">
        <h1 className="text-balance text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
          Карта Inside
        </h1>
        <p className="mt-4 max-w-[66ch] text-pretty text-base leading-7 text-muted-foreground sm:text-lg">
          Редакционная карта свяжет направления, темы, серии и отдельные материалы.
        </p>
      </header>
      <section
        aria-labelledby="map-empty-heading"
        className="mt-12 max-w-3xl border-y border-border py-6 sm:py-8"
      >
        <h2
          className="text-xl font-semibold tracking-[-0.025em]"
          id="map-empty-heading"
        >
          Связи появятся постепенно
        </h2>
        <p className="mt-3 max-w-[65ch] text-pretty text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
          Карта будет объяснять направления Inside и вести к опубликованным материалам, не
          подменяя Библиотеку второй копией каталога.
        </p>
        <p className="mt-6 flex items-center gap-3 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />
          Статус раздела: ожидает редакционные связи
        </p>
      </section>
    </>
  );
}
