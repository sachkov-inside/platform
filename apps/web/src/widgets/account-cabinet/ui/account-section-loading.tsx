/** Общее состояние загрузки раздела: рамка кабинета уже на месте, содержание ещё нет. */
export function AccountSectionLoading() {
  return (
    <div aria-busy="true" className="py-2">
      <div className="h-12 w-2/3 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
      <p className="mt-4 text-muted-foreground" role="status">
        Загружаем раздел…
      </p>
      <div className="mt-8 h-56 animate-pulse rounded-2xl border border-border bg-muted/50 motion-reduce:animate-none" />
    </div>
  );
}
