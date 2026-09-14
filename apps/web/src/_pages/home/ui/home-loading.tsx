import { HomeFrame } from "./home-frame";

export function HomeLoading() {
  return <HomeFrame>
    <div aria-busy="true" aria-label="Главная загружается">
      <div aria-hidden="true" className="home-guide-skeleton animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
      <div aria-hidden="true" className="mt-10 h-48 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
      <p className="sr-only" role="status">Загружаем руководство и материалы</p>
    </div>
  </HomeFrame>;
}
