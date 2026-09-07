export function HomeLoading() {
  return <div aria-busy="true" aria-label="Главная загружается">
    <h1 className="sr-only">Главная</h1>
    <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] md:text-3xl">Серии</h2>
    <div aria-hidden="true" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
      {[0, 1].map((item) => <div key={item} className="h-64 animate-pulse rounded-[1.5rem] bg-muted motion-reduce:animate-none" />)}
    </div>
    <div aria-hidden="true" className="mt-10 h-48 animate-pulse rounded-[1.5rem] bg-muted motion-reduce:animate-none" />
    <p className="sr-only" role="status">Загружаем материалы главной</p>
  </div>;
}
