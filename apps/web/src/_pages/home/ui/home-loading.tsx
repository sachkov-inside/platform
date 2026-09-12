import { HomeFrame, HomeSeriesSection } from "./home-frame";

/**
 * Первый экран, пока данные ещё идут. Каркас и заголовок руководств те же самые, что у готовой
 * главной, поэтому человек не видит рывка в момент, когда страница оживает.
 */
export function HomeLoading() {
  return <HomeFrame>
    <div aria-busy="true" aria-label="Главная загружается">
      <HomeSeriesSection>
        <div aria-hidden="true" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1].map((item) => <div key={item} className="h-64 animate-pulse rounded-[1.5rem] bg-muted motion-reduce:animate-none" />)}
        </div>
      </HomeSeriesSection>
      <div aria-hidden="true" className="mt-10 h-48 animate-pulse rounded-[1.5rem] bg-muted motion-reduce:animate-none" />
      <p className="sr-only" role="status">Загружаем материалы главной</p>
    </div>
  </HomeFrame>;
}
