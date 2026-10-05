import type { HomeResult } from "../model/home-view";
import { HomePage } from "./home-page";

/**
 * Главная за окном другого маршрута: только закреплённый продукт, без ленты, которая меняла бы
 * адрес страницы.
 */
export function HomeBackdrop({ result }: { readonly result: HomeResult }) {
  return <HomePage feed={<div className="min-h-[60vh]" />} result={result} />;
}
