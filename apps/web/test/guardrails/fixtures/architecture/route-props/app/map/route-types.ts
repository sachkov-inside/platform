/** Свой тип маршрута в соседнем модуле. */
export interface PageProps {
  readonly searchParams: Promise<Record<string, string>>;
}
